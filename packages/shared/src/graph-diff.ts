import type { WorkflowGraph } from './workflow-graph';

/** Diferencia estructural entre dos grafos (para comparar versiones). */
export interface GraphDiff {
  nodesAdded: { id: string; name: string; type: string }[];
  nodesRemoved: { id: string; name: string; type: string }[];
  nodesModified: { id: string; name: string; changes: string[] }[];
  edgesAdded: number;
  edgesRemoved: number;
  hasChanges: boolean;
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function diffGraphs(from: WorkflowGraph, to: WorkflowGraph): GraphDiff {
  const fromNodes = new Map(from.nodes.map((n) => [n.id, n]));
  const toNodes = new Map(to.nodes.map((n) => [n.id, n]));

  const nodesAdded: GraphDiff['nodesAdded'] = [];
  const nodesRemoved: GraphDiff['nodesRemoved'] = [];
  const nodesModified: GraphDiff['nodesModified'] = [];

  for (const [id, node] of toNodes) {
    if (!fromNodes.has(id)) {
      nodesAdded.push({ id, name: node.name, type: node.type });
    }
  }
  for (const [id, node] of fromNodes) {
    const after = toNodes.get(id);
    if (!after) {
      nodesRemoved.push({ id, name: node.name, type: node.type });
      continue;
    }
    const changes: string[] = [];
    if (node.name !== after.name) changes.push('nombre');
    if (stable(node.config) !== stable(after.config)) changes.push('configuración');
    if (node.disabled !== after.disabled) changes.push(after.disabled ? 'desactivado' : 'activado');
    if (node.type !== after.type || node.nodeVersion !== after.nodeVersion) changes.push('tipo/versión');
    if (changes.length > 0) nodesModified.push({ id, name: after.name, changes });
  }

  const fromEdges = new Set(
    from.edges.map((e) => `${e.source}:${e.sourcePort}→${e.target}:${e.targetPort}`),
  );
  const toEdges = new Set(to.edges.map((e) => `${e.source}:${e.sourcePort}→${e.target}:${e.targetPort}`));
  let edgesAdded = 0;
  let edgesRemoved = 0;
  for (const key of toEdges) if (!fromEdges.has(key)) edgesAdded++;
  for (const key of fromEdges) if (!toEdges.has(key)) edgesRemoved++;

  const hasChanges =
    nodesAdded.length > 0 ||
    nodesRemoved.length > 0 ||
    nodesModified.length > 0 ||
    edgesAdded > 0 ||
    edgesRemoved > 0;

  return { nodesAdded, nodesRemoved, nodesModified, edgesAdded, edgesRemoved, hasChanges };
}
