import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@ifnodes/database';
import {
  EMPTY_GRAPH,
  type CreateProjectInput,
  type ProjectStatus,
  type UpdateProjectInput,
} from '@ifnodes/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: { q?: string; clientId?: string; status?: ProjectStatus; includeArchived?: boolean }) {
    const where: Prisma.ProjectWhereInput = {};
    if (filters.clientId) where.clientId = filters.clientId;
    if (filters.status) where.status = filters.status;
    else if (!filters.includeArchived) where.status = { not: 'ARCHIVED' };
    if (filters.q) where.name = { contains: filters.q, mode: 'insensitive' };
    return this.prisma.client.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        client: { select: { id: true, name: true } },
        owner: { select: { id: true, name: true } },
        workflows: { where: { isMain: true }, select: { id: true, name: true } },
        _count: { select: { workflows: true, executions: true } },
      },
    });
  }

  async get(id: string) {
    const project = await this.prisma.client.project.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, status: true } },
        owner: { select: { id: true, name: true, email: true } },
        workflows: {
          orderBy: [{ isMain: 'desc' }, { updatedAt: 'desc' }],
          select: { id: true, name: true, isMain: true, updatedAt: true },
        },
        environments: { select: { id: true, kind: true } },
        _count: { select: { executions: true, testCases: true, exports: true } },
      },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    return project;
  }

  /** Crea el proyecto con su flujo principal vacío y los tres entornos. */
  async create(input: CreateProjectInput, user: User) {
    const client = await this.prisma.client.client.findUnique({
      where: { id: input.clientId },
      select: { id: true, status: true },
    });
    if (!client) throw new BadRequestException('El cliente seleccionado no existe.');
    if (client.status === 'ARCHIVED') {
      throw new BadRequestException('No se pueden crear proyectos en un cliente archivado.');
    }

    const project = await this.prisma.client.project.create({
      data: {
        clientId: input.clientId,
        name: input.name,
        description: input.description === '' ? null : input.description,
        type: input.type,
        ownerId: user.id,
        workflows: {
          create: { name: 'Flujo principal', isMain: true, draftGraph: EMPTY_GRAPH as never },
        },
        environments: {
          create: [{ kind: 'DEVELOPMENT' }, { kind: 'TESTING' }, { kind: 'PRODUCTION' }],
        },
      },
      include: { workflows: { where: { isMain: true }, select: { id: true } } },
    });

    await this.audit.log({
      userId: user.id,
      action: 'project.created',
      entityType: 'project',
      entityId: project.id,
      detail: { name: project.name, type: project.type, clientId: project.clientId },
    });
    return project;
  }

  /** Elimina el proyecto y todo lo que cuelga de él (flujos, ejecuciones, casos, versiones…). */
  async remove(id: string, user: User) {
    const project = await this.prisma.client.project.findUnique({
      where: { id },
      select: { id: true, name: true, clientId: true },
    });
    if (!project) throw new NotFoundException('Proyecto no encontrado.');
    await this.prisma.client.project.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'project.deleted',
      entityType: 'project',
      entityId: id,
      detail: { name: project.name, clientId: project.clientId },
    });
    return { ok: true };
  }

  async update(id: string, input: UpdateProjectInput, user: User) {
    const exists = await this.prisma.client.project.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Proyecto no encontrado.');
    const project = await this.prisma.client.project.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description === '' ? null : input.description,
        type: input.type,
        status: input.status,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'project.updated',
      entityType: 'project',
      entityId: project.id,
      detail: { fields: Object.keys(input) },
    });
    return project;
  }
}
