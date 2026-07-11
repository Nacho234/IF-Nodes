import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@ifnodes/database';
import {
  diffGraphs,
  validateGraphStructure,
  workflowGraphSchema,
  type WorkflowGraph,
} from '@ifnodes/shared';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class VersionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listByWorkflow(workflowId: string) {
    return this.prisma.client.workflowVersion.findMany({
      where: { workflowId },
      orderBy: { number: 'desc' },
      select: {
        id: true,
        number: true,
        description: true,
        isStable: true,
        createdAt: true,
        createdBy: { select: { name: true } },
      },
    });
  }

  async get(id: string) {
    const version = await this.prisma.client.workflowVersion.findUnique({
      where: { id },
      include: { createdBy: { select: { name: true } }, workflow: { select: { name: true, projectId: true } } },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    return version;
  }

  /**
   * Publica una versión INMUTABLE a partir del borrador.
   * Valida antes; nunca modifica una versión existente.
   */
  async publish(
    workflowId: string,
    input: { description?: string; markStable?: boolean },
    user: User,
  ) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, projectId: true, draftGraph: true },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');

    const graph = workflowGraphSchema.parse(workflow.draftGraph);
    const errors = validateGraphStructure(graph, (type) => nodeRegistry.isTrigger(type)).filter(
      (issue) => issue.level === 'error',
    );
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'No se puede publicar: el flujo tiene errores.',
        issues: errors.map((issue) => ({ path: issue.nodeId ?? '', message: issue.message })),
      });
    }

    const last = await this.prisma.client.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;

    const version = await this.prisma.client.workflowVersion.create({
      data: {
        workflowId,
        number,
        graph: graph as unknown as Prisma.InputJsonValue,
        description: input.description || null,
        isStable: false,
        createdById: user.id,
      },
    });

    if (input.markStable) {
      await this.markStableInternal(version.id, workflowId, workflow.projectId);
    }

    await this.audit.log({
      userId: user.id,
      action: 'version.published',
      entityType: 'workflowVersion',
      entityId: version.id,
      detail: { workflowId, number, stable: Boolean(input.markStable) },
    });
    return { id: version.id, number };
  }

  async markStable(id: string, user: User) {
    const version = await this.prisma.client.workflowVersion.findUnique({
      where: { id },
      include: { workflow: { select: { projectId: true } } },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    await this.markStableInternal(id, version.workflowId, version.workflow.projectId);
    await this.audit.log({
      userId: user.id,
      action: 'version.marked_stable',
      entityType: 'workflowVersion',
      entityId: id,
      detail: { number: version.number },
    });
    return { ok: true };
  }

  private async markStableInternal(versionId: string, workflowId: string, projectId: string) {
    // Solo una estable por flujo; la estable define la versión activa del proyecto
    await this.prisma.client.$transaction([
      this.prisma.client.workflowVersion.updateMany({
        where: { workflowId, isStable: true },
        data: { isStable: false },
      }),
      this.prisma.client.workflowVersion.update({ where: { id: versionId }, data: { isStable: true } }),
      this.prisma.client.project.update({
        where: { id: projectId },
        data: { activeVersionId: versionId },
      }),
    ]);
  }

  /** Copia el grafo de una versión al borrador (queda como cambios sin publicar). */
  async restore(id: string, user: User) {
    const version = await this.prisma.client.workflowVersion.findUnique({
      where: { id },
      select: { id: true, number: true, workflowId: true, graph: true },
    });
    if (!version) throw new NotFoundException('Versión no encontrada.');
    await this.prisma.client.workflow.update({
      where: { id: version.workflowId },
      data: { draftGraph: version.graph as Prisma.InputJsonValue },
    });
    await this.audit.log({
      userId: user.id,
      action: 'version.restored',
      entityType: 'workflowVersion',
      entityId: id,
      detail: { number: version.number, workflowId: version.workflowId },
    });
    return { ok: true, restoredFrom: version.number };
  }

  /** Compara dos versiones (o una versión contra el borrador si `toId` = 'draft'). */
  async compare(fromId: string, toId: string) {
    const from = await this.prisma.client.workflowVersion.findUnique({
      where: { id: fromId },
      select: { number: true, graph: true, workflowId: true },
    });
    if (!from) throw new NotFoundException('Versión de origen no encontrada.');

    let toGraph: WorkflowGraph;
    let toLabel: string;
    if (toId === 'draft') {
      const workflow = await this.prisma.client.workflow.findUnique({
        where: { id: from.workflowId },
        select: { draftGraph: true },
      });
      toGraph = workflowGraphSchema.parse(workflow?.draftGraph);
      toLabel = 'borrador';
    } else {
      const to = await this.prisma.client.workflowVersion.findUnique({
        where: { id: toId },
        select: { number: true, graph: true },
      });
      if (!to) throw new NotFoundException('Versión de destino no encontrada.');
      toGraph = workflowGraphSchema.parse(to.graph);
      toLabel = `v${to.number}`;
    }

    const fromGraph = workflowGraphSchema.parse(from.graph);
    return {
      from: `v${from.number}`,
      to: toLabel,
      diff: diffGraphs(fromGraph, toGraph),
    };
  }
}
