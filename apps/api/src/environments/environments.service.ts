import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@ifnodes/database';
import type { EnvironmentKind } from '@ifnodes/shared';
import { encryptSecret } from '@ifnodes/shared/dist/crypto';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface EnvVarView {
  id: string;
  key: string;
  secret: boolean;
  /** Valor en claro solo si no es secreto; para secretos, placeholder enmascarado */
  value: string;
  masked: boolean;
}

@Injectable()
export class EnvironmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listByProject(projectId: string) {
    const environments = await this.prisma.client.environment.findMany({
      where: { projectId },
      orderBy: { kind: 'asc' },
      include: { variables: { orderBy: { key: 'asc' } } },
    });
    return environments.map((env) => ({
      id: env.id,
      kind: env.kind,
      variables: env.variables.map(
        (v): EnvVarView => ({
          id: v.id,
          key: v.key,
          secret: v.secret,
          value: v.secret ? '••••••••' : (v.value ?? ''),
          masked: v.secret,
        }),
      ),
    }));
  }

  private async resolveEnvironment(projectId: string, kind: EnvironmentKind): Promise<string> {
    const env = await this.prisma.client.environment.upsert({
      where: { projectId_kind: { projectId, kind } },
      update: {},
      create: { projectId, kind },
    });
    return env.id;
  }

  async createVariable(
    projectId: string,
    kind: EnvironmentKind,
    input: { key: string; value: string; secret: boolean },
    user: User,
  ) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.key)) {
      throw new BadRequestException('Clave inválida: usar MAYUS_CON_GUION_BAJO.');
    }
    const environmentId = await this.resolveEnvironment(projectId, kind);
    const existing = await this.prisma.client.environmentVariable.findUnique({
      where: { environmentId_key: { environmentId, key: input.key } },
    });
    if (existing) throw new BadRequestException(`Ya existe una variable "${input.key}" en ${kind}.`);

    await this.prisma.client.environmentVariable.create({
      data: {
        environmentId,
        key: input.key,
        secret: input.secret,
        value: input.secret ? null : input.value,
        encryptedValue: input.secret ? encryptSecret(input.value) : null,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'env_var.created',
      entityType: 'environmentVariable',
      detail: { projectId, kind, key: input.key, secret: input.secret },
    });
    return { ok: true };
  }

  async updateVariable(
    id: string,
    input: { value?: string; secret?: boolean },
    user: User,
  ) {
    const existing = await this.prisma.client.environmentVariable.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Variable no encontrada.');

    const secret = input.secret ?? existing.secret;
    const data: { secret: boolean; value: string | null; encryptedValue: string | null } = {
      secret,
      value: existing.value,
      encryptedValue: existing.encryptedValue,
    };
    if (input.value !== undefined) {
      data.value = secret ? null : input.value;
      data.encryptedValue = secret ? encryptSecret(input.value) : null;
    } else if (input.secret !== undefined && input.secret !== existing.secret) {
      // Cambió el flag sin nuevo valor: mover el valor existente
      const current = existing.secret
        ? '' // no podemos recuperar un secreto para "desecretar" sin nuevo valor
        : (existing.value ?? '');
      data.value = secret ? null : current;
      data.encryptedValue = secret ? encryptSecret(current) : null;
    }

    await this.prisma.client.environmentVariable.update({ where: { id }, data });
    await this.audit.log({
      userId: user.id,
      action: 'env_var.updated',
      entityType: 'environmentVariable',
      entityId: id,
    });
    return { ok: true };
  }

  async deleteVariable(id: string, user: User) {
    const existing = await this.prisma.client.environmentVariable.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Variable no encontrada.');
    await this.prisma.client.environmentVariable.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'env_var.deleted',
      entityType: 'environmentVariable',
      entityId: id,
    });
    return { ok: true };
  }
}
