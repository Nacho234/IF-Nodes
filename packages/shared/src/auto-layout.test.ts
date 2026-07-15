import { describe, expect, it } from 'vitest';
import { autoLayout } from './auto-layout';
import type { WorkflowGraph } from './workflow-graph';

const n = (id: string) => ({ id, type: 't', nodeVersion: 1, name: id, position: { x: 0, y: 0 }, config: {}, disabled: false, notes: '' });
const e = (id: string, source: string, target: string) => ({ id, source, sourcePort: 'main', target, targetPort: 'main' });

describe('autoLayout', () => {
  it('pone una cadena en columnas crecientes de izquierda a derecha', () => {
    const g: WorkflowGraph = { nodes: [n('a'), n('b'), n('c')], edges: [e('e1', 'a', 'b'), e('e2', 'b', 'c')], stickyNotes: [], groups: [] };
    const out = autoLayout(g);
    const x = Object.fromEntries(out.nodes.map((nd) => [nd.id, nd.position.x]));
    expect(x.a).toBeLessThan(x.b);
    expect(x.b).toBeLessThan(x.c);
  });

  it('reparte los hermanos de una rama en filas distintas (no se enciman)', () => {
    const g: WorkflowGraph = {
      nodes: [n('cond'), n('si'), n('no')],
      edges: [e('e1', 'cond', 'si'), e('e2', 'cond', 'no')],
      stickyNotes: [], groups: [],
    };
    const out = autoLayout(g);
    const pos = Object.fromEntries(out.nodes.map((nd) => [nd.id, nd.position]));
    // si y no están en la misma columna (misma x) pero distinta fila (distinta y)
    expect(pos.si.x).toBe(pos.no.x);
    expect(pos.si.y).not.toBe(pos.no.y);
  });

  it('no cambia nodos ni conexiones, solo posiciones', () => {
    const g: WorkflowGraph = { nodes: [n('a'), n('b')], edges: [e('e1', 'a', 'b')], stickyNotes: [], groups: [] };
    const out = autoLayout(g);
    expect(out.nodes.map((x) => x.id)).toEqual(['a', 'b']);
    expect(out.edges).toEqual(g.edges);
  });
});
