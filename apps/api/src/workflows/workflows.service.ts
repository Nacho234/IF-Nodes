import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@ifnodes/database';
import {
  validateGraphStructure,
  workflowGraphSchema,
  type GraphIssue,
  type WorkflowGraph,
} from '@ifnodes/shared';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface NodeConfigIssue {
  nodeId: string;
  nodeName: string;
  field: string;
  message: string;
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(id: string) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true, clientId: true, client: { select: { name: true } } } },
        versions: { orderBy: { number: 'desc' }, take: 10, select: { id: true, number: true, isStable: true, createdAt: true } },
      },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');
    return workflow;
  }

  /**
   * Guarda el borrador. Política de guardado:
   * - el grafo tiene que ser estructuralmente válido según el schema (si no, 400);
   * - los problemas "semánticos" (sin trigger, nodos sueltos, configs incompletas)
   *   NO bloquean el guardado (es un borrador en edición): se devuelven como issues
   *   para que el editor los muestre. Publicar una versión (Fase 8) sí los exigirá.
   */
  async saveDraft(id: string, graph: WorkflowGraph, user: User) {
    const existing = await this.prisma.client.workflow.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new NotFoundException('Flujo no encontrado.');

    const workflow = await this.prisma.client.workflow.update({
      where: { id },
      data: { draftGraph: graph as never },
      select: { id: true, updatedAt: true },
    });

    await this.audit.log({
      userId: user.id,
      action: 'workflow.draft_saved',
      entityType: 'workflow',
      entityId: id,
      detail: { nodes: graph.nodes.length, edges: graph.edges.length },
    });

    return {
      id: workflow.id,
      savedAt: workflow.updatedAt,
      ...this.analyzeGraph(graph),
    };
  }

  async validate(id: string) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id },
      select: { draftGraph: true },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');
    const graph = workflowGraphSchema.parse(workflow.draftGraph);
    return this.analyzeGraph(graph);
  }

  private analyzeGraph(graph: WorkflowGraph): {
    structureIssues: GraphIssue[];
    configIssues: NodeConfigIssue[];
  } {
    const structureIssues = validateGraphStructure(graph, (type) => nodeRegistry.isTrigger(type));

    const configIssues: NodeConfigIssue[] = [];
    for (const node of graph.nodes) {
      if (node.disabled) continue;
      const definition = nodeRegistry.get(node.type, node.nodeVersion);
      if (!definition) {
        configIssues.push({
          nodeId: node.id,
          nodeName: node.name,
          field: '',
          message: `Tipo de nodo desconocido: ${node.type} v${node.nodeVersion}`,
        });
        continue;
      }
      const result = definition.configSchema.safeParse(node.config);
      if (!result.success) {
        for (const issue of result.error.issues) {
          configIssues.push({
            nodeId: node.id,
            nodeName: node.name,
            field: issue.path.join('.'),
            message: issue.message,
          });
        }
      }
    }
    return { structureIssues, configIssues };
  }
}
