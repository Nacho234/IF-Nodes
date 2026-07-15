import { autoLayout, type GraphEdge, type GraphNode, type WorkflowGraph } from '@ifnodes/shared';
import type { CopilotChangeSet } from './schemas';

/**
 * Aplicación de un ChangeSet propuesto por el copilot sobre un grafo. Función
 * PURA y validada: chequea tipos de nodo, ids/refs y existencia antes de tocar
 * nada. Si algún cambio es inválido, no aplica NADA y devuelve los errores
 * (la aplicación es todo-o-nada). Usable en el front (con el registro del store)
 * o en el backend (con nodeRegistry).
 */

export interface NodeTypeMeta {
  version: number;
  defaultConfig: unknown;
}

/** Devuelve metadata del tipo de nodo, o undefined si no existe en el registro. */
export type NodeTypeResolver = (nodeType: string) => NodeTypeMeta | undefined;

export type IdGenerator = (prefix: string) => string;

export interface ApplyChangeSetResult {
  ok: boolean;
  /** Grafo resultante (solo si ok). */
  graph?: WorkflowGraph;
  /** Acciones aplicadas, legibles, en orden. */
  applied: string[];
  /** Errores de validación (si los hay, no se aplicó nada). */
  errors: string[];
}

const defaultGenId: IdGenerator = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function applyChangeSet(
  graph: WorkflowGraph,
  changeSet: CopilotChangeSet,
  resolve: NodeTypeResolver,
  genId: IdGenerator = defaultGenId,
): ApplyChangeSetResult {
  const nodes: GraphNode[] = graph.nodes.map((n) => ({ ...n, config: { ...n.config } }));
  const edges: GraphEdge[] = graph.edges.map((e) => ({ ...e }));
  const errors: string[] = [];
  const applied: string[] = [];
  const refMap = new Map<string, string>();

  const nodeById = (id: string) => nodes.find((n) => n.id === id);
  const nameOf = (id: string) => nodeById(id)?.name ?? id;
  const resolveRef = (handle: string) => refMap.get(handle) ?? handle;

  const addEdge = (from: string, fromPort: string, to: string, toPort: string, label: string) => {
    const source = resolveRef(from);
    const target = resolveRef(to);
    if (!nodeById(source)) {
      errors.push(`${label}: el nodo origen "${from}" no existe.`);
      return;
    }
    if (!nodeById(target)) {
      errors.push(`${label}: el nodo destino "${to}" no existe.`);
      return;
    }
    if (source === target) {
      errors.push(`${label}: un nodo no puede conectarse a sí mismo.`);
      return;
    }
    const dup = edges.some(
      (e) => e.source === source && e.target === target && e.sourcePort === fromPort && e.targetPort === toPort,
    );
    if (dup) return; // idempotente: no duplicar conexiones
    edges.push({ id: genId('edge'), source, sourcePort: fromPort, target, targetPort: toPort });
    applied.push(`conectar ${nameOf(source)} → ${nameOf(target)}`);
  };

  for (const change of changeSet.changes) {
    switch (change.op) {
      case 'add_node': {
        const meta = resolve(change.nodeType);
        if (!meta) {
          errors.push(`Tipo de nodo desconocido: "${change.nodeType}".`);
          break;
        }
        if (change.ref && refMap.has(change.ref)) {
          errors.push(`El ref "${change.ref}" está repetido.`);
          break;
        }
        const id = genId('node');
        nodes.push({
          id,
          type: change.nodeType,
          nodeVersion: meta.version,
          name: change.name,
          position: { x: 0, y: 0 }, // se posiciona al final
          config: { ...asRecord(meta.defaultConfig), ...change.config },
          disabled: false,
          notes: '',
        });
        if (change.ref) refMap.set(change.ref, id);
        applied.push(`agregar "${change.name}" (${change.nodeType})`);
        if (change.connectFromNodeId) {
          addEdge(change.connectFromNodeId, change.sourcePort, id, 'main', 'add_node/connect');
        }
        break;
      }
      case 'add_edge':
        addEdge(change.from, change.fromPort, change.to, change.toPort, 'add_edge');
        break;
      case 'update_config': {
        const target = resolveRef(change.nodeId);
        const node = nodeById(target);
        if (!node) {
          errors.push(`update_config: el nodo "${change.nodeId}" no existe.`);
          break;
        }
        node.config = { ...node.config, ...change.config };
        applied.push(`configurar "${node.name}"`);
        break;
      }
      case 'delete_node': {
        const target = resolveRef(change.nodeId);
        const node = nodeById(target);
        if (!node) {
          errors.push(`delete_node: el nodo "${change.nodeId}" no existe.`);
          break;
        }
        const index = nodes.findIndex((n) => n.id === target);
        nodes.splice(index, 1);
        for (let i = edges.length - 1; i >= 0; i -= 1) {
          if (edges[i]!.source === target || edges[i]!.target === target) edges.splice(i, 1);
        }
        applied.push(`eliminar "${node.name}"`);
        break;
      }
      default:
        break;
    }
  }

  if (errors.length > 0) return { ok: false, applied: [], errors };

  // Auto-layout en capas: deja el flujo ordenado y legible de izquierda a derecha.
  const graphOut = autoLayout({ ...graph, nodes, edges });
  return { ok: true, graph: graphOut, applied, errors: [] };
}

