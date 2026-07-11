import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@ifnodes/database';
import {
  CREDENTIAL_TYPES,
  credentialType,
  type CreateCredentialInput,
  type EnvironmentKind,
  type UpdateCredentialInput,
} from '@ifnodes/shared';
import { decryptSecret, encryptSecret } from '@ifnodes/shared/dist/crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

/** Vista segura de una credencial: sin secretos, con hint enmascarado. */
export interface CredentialView {
  id: string;
  name: string;
  integrationSlug: string;
  integrationName: string;
  environment: EnvironmentKind;
  projectId: string | null;
  active: boolean;
  lastVerifiedAt: Date | null;
  maskedHint: string | null;
  /** Campos no secretos en claro (host, phoneNumberId…) para mostrar/editar */
  publicFields: Record<string, string>;
  createdAt: Date;
}

function maskSecret(value: string): string {
  if (value.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(8, value.length - 4))}${value.slice(-4)}`;
}

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async ensureIntegration(slug: string): Promise<string> {
    const type = credentialType(slug);
    if (!type) throw new BadRequestException('Tipo de credencial desconocido.');
    const integration = await this.prisma.client.integration.upsert({
      where: { slug },
      update: {},
      create: { slug, name: type.name, description: type.description },
    });
    return integration.id;
  }

  /** Separa los campos en secretos (cifrados) y públicos (en claro). */
  private splitFields(slug: string, data: Record<string, string>) {
    const type = credentialType(slug);
    if (!type) throw new BadRequestException('Tipo de credencial desconocido.');
    const publicFields: Record<string, string> = {};
    let firstSecret = '';
    for (const field of type.fields) {
      const value = data[field.key] ?? '';
      if (field.secret) {
        if (value && !firstSecret) firstSecret = value;
      } else {
        publicFields[field.key] = value;
      }
    }
    return { publicFields, maskedHint: firstSecret ? maskSecret(firstSecret) : null };
  }

  async list(filters: { projectId?: string; environment?: EnvironmentKind }): Promise<CredentialView[]> {
    const where: Prisma.CredentialWhereInput = {};
    if (filters.projectId) where.projectId = filters.projectId;
    else where.projectId = null; // credenciales globales por defecto
    if (filters.environment) where.environment = filters.environment;
    const rows = await this.prisma.client.credential.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { integration: true },
    });
    return rows.map((row) => this.toView(row));
  }

  async get(id: string): Promise<CredentialView> {
    const row = await this.prisma.client.credential.findUnique({
      where: { id },
      include: { integration: true },
    });
    if (!row) throw new NotFoundException('Credencial no encontrada.');
    return this.toView(row);
  }

  private toView(row: {
    id: string;
    name: string;
    environment: string;
    projectId: string | null;
    active: boolean;
    lastVerifiedAt: Date | null;
    maskedHint: string | null;
    encryptedData: string;
    createdAt: Date;
    integration: { slug: string; name: string };
  }): CredentialView {
    let publicFields: Record<string, string> = {};
    try {
      const decrypted = JSON.parse(decryptSecret(row.encryptedData)) as Record<string, string>;
      const { publicFields: pf } = this.splitFields(row.integration.slug, decrypted);
      publicFields = pf;
    } catch {
      publicFields = {};
    }
    return {
      id: row.id,
      name: row.name,
      integrationSlug: row.integration.slug,
      integrationName: row.integration.name,
      environment: row.environment as EnvironmentKind,
      projectId: row.projectId,
      active: row.active,
      lastVerifiedAt: row.lastVerifiedAt,
      maskedHint: row.maskedHint,
      publicFields,
      createdAt: row.createdAt,
    };
  }

  async create(input: CreateCredentialInput, user: User): Promise<CredentialView> {
    const integrationId = await this.ensureIntegration(input.integrationSlug);
    const { maskedHint } = this.splitFields(input.integrationSlug, input.data);
    const row = await this.prisma.client.credential.create({
      data: {
        name: input.name,
        integrationId,
        projectId: input.projectId ? input.projectId : null,
        environment: input.environment,
        encryptedData: encryptSecret(JSON.stringify(input.data)),
        maskedHint,
        createdById: user.id,
      },
      include: { integration: true },
    });
    await this.audit.log({
      userId: user.id,
      action: 'credential.created',
      entityType: 'credential',
      entityId: row.id,
      detail: { name: input.name, type: input.integrationSlug, environment: input.environment },
    });
    return this.toView(row);
  }

  async update(id: string, input: UpdateCredentialInput, user: User): Promise<CredentialView> {
    const existing = await this.prisma.client.credential.findUnique({
      where: { id },
      include: { integration: true },
    });
    if (!existing) throw new NotFoundException('Credencial no encontrada.');

    const data: Prisma.CredentialUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.active !== undefined) data.active = input.active;
    if (input.data) {
      const { maskedHint } = this.splitFields(existing.integration.slug, input.data);
      data.encryptedData = encryptSecret(JSON.stringify(input.data));
      data.maskedHint = maskedHint;
      data.lastVerifiedAt = null; // rotación invalida la última verificación
    }
    const row = await this.prisma.client.credential.update({
      where: { id },
      data,
      include: { integration: true },
    });
    await this.audit.log({
      userId: user.id,
      action: input.data ? 'credential.rotated' : 'credential.updated',
      entityType: 'credential',
      entityId: id,
    });
    return this.toView(row);
  }

  async remove(id: string, user: User): Promise<{ ok: boolean }> {
    const existing = await this.prisma.client.credential.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Credencial no encontrada.');
    await this.prisma.client.credential.delete({ where: { id } });
    await this.audit.log({ userId: user.id, action: 'credential.deleted', entityType: 'credential', entityId: id });
    return { ok: true };
  }

  /** Prueba de conexión real (sin exponer el secreto). */
  async verify(id: string, user: User): Promise<{ ok: boolean; message: string }> {
    const row = await this.prisma.client.credential.findUnique({
      where: { id },
      include: { integration: true },
    });
    if (!row) throw new NotFoundException('Credencial no encontrada.');
    const data = JSON.parse(decryptSecret(row.encryptedData)) as Record<string, string>;

    const result = await this.testConnection(row.integration.slug, data);
    if (result.ok) {
      await this.prisma.client.credential.update({ where: { id }, data: { lastVerifiedAt: new Date() } });
    }
    await this.audit.log({
      userId: user.id,
      action: 'credential.verified',
      entityType: 'credential',
      entityId: id,
      detail: { ok: result.ok },
    });
    return result;
  }

  private async testConnection(
    slug: string,
    data: Record<string, string>,
  ): Promise<{ ok: boolean; message: string }> {
    try {
      if (slug === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/models', {
          headers: { 'x-api-key': data.apiKey ?? '', 'anthropic-version': '2023-06-01' },
          signal: AbortSignal.timeout(8000),
        });
        return response.ok
          ? { ok: true, message: 'Conexión con Anthropic verificada.' }
          : { ok: false, message: `Anthropic rechazó la key (HTTP ${response.status}).` };
      }
      if (slug === 'openai') {
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { authorization: `Bearer ${data.apiKey ?? ''}` },
          signal: AbortSignal.timeout(8000),
        });
        return response.ok
          ? { ok: true, message: 'Conexión con OpenAI verificada.' }
          : { ok: false, message: `OpenAI rechazó la key (HTTP ${response.status}).` };
      }
      if (slug === 'whatsapp-cloud') {
        const response = await fetch(
          `https://graph.facebook.com/v20.0/${data.phoneNumberId ?? ''}?access_token=${encodeURIComponent(data.accessToken ?? '')}`,
          { signal: AbortSignal.timeout(8000) },
        );
        return response.ok
          ? { ok: true, message: 'Conexión con WhatsApp Cloud verificada.' }
          : { ok: false, message: `WhatsApp Cloud rechazó los datos (HTTP ${response.status}).` };
      }
      const type = CREDENTIAL_TYPES.find((t) => t.slug === slug);
      return {
        ok: false,
        message: `${type?.name ?? slug} no tiene prueba de conexión automática todavía.`,
      };
    } catch (error) {
      return {
        ok: false,
        message: `No se pudo conectar: ${error instanceof Error ? error.message : 'error desconocido'}`,
      };
    }
  }
}
