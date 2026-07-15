import type { WorkflowGraph } from './workflow-graph';

/**
 * Auto-layout en capas de izquierda a derecha: ubica cada nodo en una columna
 * según su distancia al disparador (orden topológico) y reparte los de la misma
 * columna en filas. Solo cambia posiciones (x,y) — no toca nodos, conexiones ni
 * config, así que NUNCA rompe el flujo. Las notas del lienzo quedan como están.
 */

const COL_GAP = 300;
const ROW_GAP = 130;
const X0 = 80;
const Y0 = 80;

export function autoLayout(graph: WorkflowGraph): WorkflowGraph {
  const nodes = graph.nodes;
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const id of ids) {
    out.set(id, []);
    indeg.set(id, 0);
  }
  for (const edge of graph.edges) {
    if (idSet.has(edge.source) && idSet.has(edge.target) && edge.source !== edge.target) {
      out.get(edge.source)!.push(edge.target);
      indeg.set(edge.target, (indeg.get(edge.target) ?? 0) + 1);
    }
  }

  // Capa = camino más largo desde un nodo raíz (orden topológico tipo Kahn)
  const layer = new Map<string, number>(ids.map((id) => [id, 0]));
  const localIndeg = new Map(indeg);
  const queue = ids.filter((id) => (localIndeg.get(id) ?? 0) === 0);
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const next of out.get(id) ?? []) {
      layer.set(next, Math.max(layer.get(next) ?? 0, (layer.get(id) ?? 0) + 1));
      const deg = (localIndeg.get(next) ?? 0) - 1;
      localIndeg.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }
  // (Si hay un ciclo, los nodos del ciclo quedan en capa 0; la validación ya
  // marca los ciclos como error aparte.)

  const byLayer = new Map<number, string[]>();
  for (const id of ids) {
    const l = layer.get(id) ?? 0;
    const group = byLayer.get(l) ?? [];
    group.push(id);
    byLayer.set(l, group);
  }

  const position = new Map<string, { x: number; y: number }>();
  for (const [l, group] of byLayer) {
    // Orden estable dentro de la columna: por su y original
    group.sort((a, b) => (nodeById.get(a)!.position.y ?? 0) - (nodeById.get(b)!.position.y ?? 0));
    group.forEach((id, index) => position.set(id, { x: X0 + l * COL_GAP, y: Y0 + index * ROW_GAP }));
  }

  return {
    ...graph,
    nodes: nodes.map((n) => ({ ...n, position: position.get(n.id) ?? n.position })),
  };
}
