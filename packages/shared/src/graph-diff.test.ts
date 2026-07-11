import { describe, expect, it } from 'vitest';
import { diffGraphs } from './graph-diff';
import type { WorkflowGraph } from './workflow-graph';

function node(id: string, overrides: Partial<WorkflowGraph['nodes'][number]> = {}) {
  return {
    id,
    type: 'data.transform',
    nodeVersion: 1,
    name: id,
    position: { x: 0, y: 0 },
    config: {},
    disabled: false,
    notes: '',
    ...overrides,
  };
}
function edge(id: string, source: string, target: string) {
  return { id, source, sourcePort: 'main', target, targetPort: 'main' };
}
const graph = (nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges'] = []): WorkflowGraph => ({
  nodes,
  edges,
  stickyNotes: [],
  groups: [],
});

describe('diffGraphs', () => {
  it('sin cambios', () => {
    const g = graph([node('a')], []);
    expect(diffGraphs(g, g).hasChanges).toBe(false);
  });

  it('detecta nodos agregados y eliminados', () => {
    const from = graph([node('a')]);
    const to = graph([node('b')]);
    const diff = diffGraphs(from, to);
    expect(diff.nodesAdded.map((n) => n.id)).toEqual(['b']);
    expect(diff.nodesRemoved.map((n) => n.id)).toEqual(['a']);
    expect(diff.hasChanges).toBe(true);
  });

  it('detecta cambios de nombre y config', () => {
    const from = graph([node('a', { name: 'Viejo', config: { x: 1 } })]);
    const to = graph([node('a', { name: 'Nuevo', config: { x: 2 } })]);
    const diff = diffGraphs(from, to);
    expect(diff.nodesModified).toHaveLength(1);
    expect(diff.nodesModified[0]?.changes).toContain('nombre');
    expect(diff.nodesModified[0]?.changes).toContain('configuración');
  });

  it('cuenta aristas agregadas/eliminadas', () => {
    const from = graph([node('a'), node('b')], [edge('e1', 'a', 'b')]);
    const to = graph([node('a'), node('b')], [edge('e2', 'b', 'a')]);
    const diff = diffGraphs(from, to);
    expect(diff.edgesAdded).toBe(1);
    expect(diff.edgesRemoved).toBe(1);
  });

  it('ignora reordenamiento de posición (no es cambio funcional)', () => {
    const from = graph([node('a', { position: { x: 0, y: 0 } })]);
    const to = graph([node('a', { position: { x: 500, y: 500 } })]);
    expect(diffGraphs(from, to).hasChanges).toBe(false);
  });
});
