import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@ifnodes/database';
import type { ClientStatus, CreateClientInput, UpdateClientInput } from '@ifnodes/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

function emptyToNull(value: string | undefined): string | null | undefined {
  return value === '' ? null : value;
}

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: { q?: string; status?: ClientStatus; includeArchived?: boolean }) {
    const where: Prisma.ClientWhereInput = {};
    if (filters.status) where.status = filters.status;
    else if (!filters.includeArchived) where.status = { not: 'ARCHIVED' };
    if (filters.q) {
      where.OR = [
        { name: { contains: filters.q, mode: 'insensitive' } },
        { legalName: { contains: filters.q, mode: 'insensitive' } },
        { contactName: { contains: filters.q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.client.client.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { projects: true } } },
    });
  }

  async get(id: string) {
    const client = await this.prisma.client.client.findUnique({
      where: { id },
      include: {
        projects: { orderBy: { updatedAt: 'desc' } },
        _count: { select: { projects: true } },
      },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado.');
    return client;
  }

  async create(input: CreateClientInput, user: User) {
    const client = await this.prisma.client.client.create({
      data: {
        name: input.name,
        legalName: emptyToNull(input.legalName),
        industry: emptyToNull(input.industry),
        contactName: emptyToNull(input.contactName),
        contactEmail: emptyToNull(input.contactEmail),
        contactPhone: emptyToNull(input.contactPhone),
        status: input.status,
        internalNotes: emptyToNull(input.internalNotes),
        createdById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'client.created',
      entityType: 'client',
      entityId: client.id,
      detail: { name: client.name },
    });
    return client;
  }

  async update(id: string, input: UpdateClientInput, user: User) {
    await this.ensureExists(id);
    const client = await this.prisma.client.client.update({
      where: { id },
      data: {
        name: input.name,
        legalName: emptyToNull(input.legalName),
        industry: emptyToNull(input.industry),
        contactName: emptyToNull(input.contactName),
        contactEmail: emptyToNull(input.contactEmail),
        contactPhone: emptyToNull(input.contactPhone),
        status: input.status,
        internalNotes: emptyToNull(input.internalNotes),
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'client.updated',
      entityType: 'client',
      entityId: client.id,
      detail: { fields: Object.keys(input) },
    });
    return client;
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.client.client.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Cliente no encontrado.');
  }
}
