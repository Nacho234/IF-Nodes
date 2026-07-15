import { Injectable, NotFoundException } from '@nestjs/common';
import type { User } from '@ifnodes/database';
import {
  validateGraphStructure,
  workflowGraphSchema,
  type GraphIssue,
  type WorkflowGraph,
} from '@ifnodes/shared';
import { analyzeReadiness, findExpressionIssues, nodeRegistry } from '@ifnodes/node-definitions';
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

  /** Checklist de "Puesta en marcha": qué falta conectar/cargar para que corra de verdad. */
  async readiness(id: string) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id },
      select: { draftGraph: true, projectId: true },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');

    const [credentials, knowledgeCount, environments] = await Promise.all([
      this.prisma.client.credential.findMany({
        where: { active: true, OR: [{ projectId: workflow.projectId }, { projectId: null }] },
        select: { integration: { select: { slug: true } } },
      }),
      this.prisma.client.knowledgeChunk.count({ where: { projectId: workflow.projectId } }),
      this.prisma.client.environment.findMany({
        where: { projectId: workflow.projectId },
        select: { variables: { select: { key: true } } },
      }),
    ]);

    const parsed = workflowGraphSchema.safeParse(workflow.draftGraph);
    const graph: WorkflowGraph = parsed.success
      ? parsed.data
      : { nodes: [], edges: [], stickyNotes: [], groups: [] };

    const environmentKeys = Array.from(
      new Set(environments.flatMap((env) => env.variables.map((v) => v.key))),
    );

    return {
      items: analyzeReadiness(graph, {
        availableCredentialTypes: credentials.map((c) => c.integration.slug),
        knowledgeCount,
        environmentKeys,
      }),
    };
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

    // Referencias de expresiones mal escritas (atajos inexistentes, nodos que no están)
    for (const issue of findExpressionIssues(graph)) {
      configIssues.push(issue);
    }

    return { structureIssues, configIssues };
  }
}
