import { z } from 'zod';

/**
 * Contrato del grafo de un flujo. Es la única forma válida de persistir
 * un flujo (borrador o versión) y lo consumen editor, API, motor y runtime.
 * No contiene secretos: los nodos referencian credenciales por id y
 * variables de entorno por expresión {{environment.X}}.
 */

export const graphPositionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

/** Manejo de errores por nodo; el motor aplica defaults si falta. */
export const nodeErrorPolicySchema = z.object({
  strategy: z.enum(['stop', 'continue', 'retry', 'error-output', 'fallback']),
  retries: z.number().int().min(0).max(10).optional(),
  retryDelayMs: z.number().int().min(0).max(600_000).optional(),
  backoff: z.enum(['fixed', 'exponential']).optional(),
  timeoutMs: z.number().int().min(100).max(600_000).optional(),
  fallbackValue: z.unknown().optional(),
});
export type NodeErrorPolicy = z.infer<typeof nodeErrorPolicySchema>;

export const graphNodeSchema = z.object({
  id: z.string().min(1).max(64),
  /** Tipo registrado en node-definitions, p.ej. "trigger.manual" */
  type: z.string().min(1).max(100),
  /** Versión de la definición con la que se configuró el nodo */
  nodeVersion: z.number().int().positive(),
  /** Nombre visible, renombrable por el usuario */
  name: z.string().min(1).max(120),
  position: graphPositionSchema,
  /** Config específica del nodo; el configSchema del tipo la valida aparte */
  config: z.record(z.string(), z.unknown()).default({}),
  disabled: z.boolean().default(false),
  notes: z.string().max(2000).default(''),
  errorPolicy: nodeErrorPolicySchema.optional(),
});

export const graphEdgeSchema = z.object({
  id: z.string().min(1).max(64),
  source: z.string().min(1),
  /** Puerto de salida del nodo origen (p.ej. "main", "true", "false") */
  sourcePort: z.string().min(1).max(40).default('main'),
  target: z.string().min(1),
  targetPort: z.string().min(1).max(40).default('main'),
});

export const stickyNoteSchema = z.object({
  id: z.string().min(1).max(64),
  position: graphPositionSchema,
  width: z.number().positive().max(4000).default(240),
  height: z.number().positive().max(4000).default(120),
  text: z.string().max(4000).default(''),
});

export const nodeGroupSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().max(120).default(''),
  nodeIds: z.array(z.string()).default([]),
});

export const workflowGraphSchema = z
  .object({
    nodes: z.array(graphNodeSchema).max(500),
    edges: z.array(graphEdgeSchema).max(1000),
    stickyNotes: z.array(stickyNoteSchema).max(100).default([]),
    groups: z.array(nodeGroupSchema).max(100).default([]),
  })
  .superRefine((graph, ctx) => {
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
      if (nodeIds.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Id de nodo duplicado: ${node.id}`,
          path: ['nodes'],
        });
      }
      nodeIds.add(node.id);
    }
    for (const edge of graph.edges) {
      if (!nodeIds.has(edge.source)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `La conexión ${edge.id} referencia un nodo origen inexistente (${edge.source})`,
          path: ['edges'],
        });
      }
      if (!nodeIds.has(edge.target)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `La conexión ${edge.id} referencia un nodo destino inexistente (${edge.target})`,
          path: ['edges'],
        });
      }
    }
  });

export type WorkflowGraph = z.infer<typeof workflowGraphSchema>;
export type GraphNode = z.infer<typeof graphNodeSchema>;
export type GraphEdge = z.infer<typeof graphEdgeSchema>;

export const EMPTY_GRAPH: WorkflowGraph = {
  nodes: [],
  edges: [],
  stickyNotes: [],
  groups: [],
};

/* ── Validación estructural (editor y publicación) ─────────── */

export type GraphIssueLevel = 'error' | 'warning';

export interface GraphIssue {
  level: GraphIssueLevel;
  code:
    | 'NO_TRIGGER'
    | 'MULTIPLE_TRIGGERS'
    | 'DISCONNECTED_NODE'
    | 'CYCLE_DETECTED'
    | 'DUPLICATE_EDGE';
  message: string;
  nodeId?: string;
}

/**
 * Validación estructural del grafo, compartida entre editor (feedback en vivo)
 * y API (al guardar/publicar). `isTrigger` la provee node-definitions para no
 * acoplar este paquete al registro de nodos.
 */
export function validateGraphStructure(
  graph: WorkflowGraph,
  isTrigger: (nodeType: string) => boolean,
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const activeNodes = graph.nodes.filter((n) => !n.disabled);

  const triggers = activeNodes.filter((n) => isTrigger(n.type));
  if (activeNodes.length > 0 && triggers.length === 0) {
    issues.push({
      level: 'error',
      code: 'NO_TRIGGER',
      message: 'El flujo no tiene un disparador. Agregá un nodo de inicio.',
    });
  }
  if (triggers.length > 1) {
    for (const t of triggers.slice(1)) {
      issues.push({
        level: 'error',
        code: 'MULTIPLE_TRIGGERS',
        message: `Hay más de un disparador activo ("${t.name}"). Dejá uno solo o desactivá el resto.`,
        nodeId: t.id,
      });
    }
  }

  // Conexiones duplicadas (mismo origen/puerto → mismo destino/puerto)
  const edgeKeys = new Set<string>();
  for (const edge of graph.edges) {
    const key = `${edge.source}:${edge.sourcePort}→${edge.target}:${edge.targetPort}`;
    if (edgeKeys.has(key)) {
      issues.push({
        level: 'warning',
        code: 'DUPLICATE_EDGE',
        message: 'Hay una conexión duplicada entre los mismos nodos y puertos.',
        nodeId: edge.source,
      });
    }
    edgeKeys.add(key);
  }

  // Nodos desconectados (alcanzabilidad desde los triggers)
  if (triggers.length > 0) {
    const adjacency = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = adjacency.get(edge.source) ?? [];
      list.push(edge.target);
      adjacency.set(edge.source, list);
    }
    const reachable = new Set<string>();
    const queue = triggers.map((t) => t.id);
    while (queue.length > 0) {
      const current = queue.pop() as string;
      if (reachable.has(current)) continue;
      reachable.add(current);
      for (const next of adjacency.get(current) ?? []) queue.push(next);
    }
    for (const node of activeNodes) {
      if (!reachable.has(node.id)) {
        issues.push({
          level: 'warning',
          code: 'DISCONNECTED_NODE',
          message: `El nodo "${node.name}" no está conectado al flujo y no se va a ejecutar.`,
          nodeId: node.id,
        });
      }
    }
  }

  // Ciclos (DFS con colores)
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>(graph.nodes.map((n) => [n.id, WHITE]));
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = adjacency.get(edge.source) ?? [];
    list.push(edge.target);
    adjacency.set(edge.source, list);
  }
  const cycleNodes = new Set<string>();
  const visit = (nodeId: string): boolean => {
    color.set(nodeId, GRAY);
    for (const next of adjacency.get(nodeId) ?? []) {
      const c = color.get(next);
      if (c === GRAY) {
        cycleNodes.add(next);
        return true;
      }
      if (c === WHITE && visit(next)) return true;
    }
    color.set(nodeId, BLACK);
    return false;
  };
  for (const node of graph.nodes) {
    if (color.get(node.id) === WHITE) visit(node.id);
  }
  for (const nodeId of cycleNodes) {
    issues.push({
      level: 'error',
      code: 'CYCLE_DETECTED',
      message: 'El flujo tiene un ciclo: un nodo termina volviendo a sí mismo.',
      nodeId,
    });
  }

  return issues;
}
