import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@ifnodes/shared';
import { applyChangeSet, type NodeTypeResolver } from './apply';
import { parseChangeSet } from './schemas';

const KNOWN: Record<string, { version: number; defaultConfig: unknown }> = {
  'trigger.manual': { version: 1, defaultConfig: {} },
  'logic.condition': { version: 1, defaultConfig: { operator: 'equals', value: '' } },
  'communication.respond': { version: 2, defaultConfig: { message: '' } },
};
const resolve: NodeTypeResolver = (type) => KNOWN[type];

// genId determinista para tests estables
function counterGen() {
  let n = 0;
  return (prefix: string) => `${prefix}${(n += 1)}`;
}

function graphWith(nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges'] = []): WorkflowGraph {
  return { nodes, edges, stickyNotes: [], groups: [] };
}

const trigger = {
  id: 't1',
  type: 'trigger.manual',
  nodeVersion: 1,
  name: 'Inicio',
  position: { x: 100, y: 100 },
  config: {},
  disabled: false,
  notes: '',
};

describe('applyChangeSet', () => {
  it('agrega un nodo con ref y lo conecta con add_edge', () => {
    const cs = parseChangeSet({
      summary: 'condición tras el inicio',
      changes: [
        { op: 'add_node', ref: 'c', nodeType: 'logic.condition', name: 'Es cliente' },
        { op: 'add_edge', from: 't1', to: 'c' },
      ],
    });
    expect(cs.ok).toBe(true);
    if (!cs.ok) return;
    const result = applyChangeSet(graphWith([trigger]), cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(true);
    expect(result.graph!.nodes).toHaveLength(2);
    expect(result.graph!.edges).toHaveLength(1);
    const added = result.graph!.nodes.find((n) => n.type === 'logic.condition')!;
    // defaultConfig fusionado
    expect(added.config.operator).toBe('equals');
    // posicionado a la derecha del origen
    expect(added.position.x).toBe(trigger.position.x + 280);
    // la conexión apunta al id real del nuevo nodo
    expect(result.graph!.edges[0]!.target).toBe(added.id);
  });

  it('usa el atajo connectFromNodeId', () => {
    const cs = parseChangeSet({
      summary: 'responder',
      changes: [
        { op: 'add_node', nodeType: 'communication.respond', name: 'Responder', connectFromNodeId: 't1' },
      ],
    });
    if (!cs.ok) throw new Error('changeset inválido');
    const result = applyChangeSet(graphWith([trigger]), cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(true);
    expect(result.graph!.edges).toHaveLength(1);
    expect(result.graph!.edges[0]!.source).toBe('t1');
  });

  it('fusiona config con update_config', () => {
    const respond = { ...trigger, id: 'r1', type: 'communication.respond', name: 'Responder', config: { message: 'hola' } };
    const cs = parseChangeSet({
      summary: 'cambiar mensaje',
      changes: [{ op: 'update_config', nodeId: 'r1', config: { message: 'chau' } }],
    });
    if (!cs.ok) throw new Error('inválido');
    const result = applyChangeSet(graphWith([respond]), cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(true);
    expect(result.graph!.nodes[0]!.config.message).toBe('chau');
  });

  it('elimina un nodo y sus conexiones', () => {
    const respond = { ...trigger, id: 'r1', type: 'communication.respond', name: 'Responder', config: {} };
    const graph = graphWith([trigger, respond], [
      { id: 'e1', source: 't1', sourcePort: 'main', target: 'r1', targetPort: 'main' },
    ]);
    const cs = parseChangeSet({ summary: 'borrar', changes: [{ op: 'delete_node', nodeId: 'r1' }] });
    if (!cs.ok) throw new Error('inválido');
    const result = applyChangeSet(graph, cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(true);
    expect(result.graph!.nodes).toHaveLength(1);
    expect(result.graph!.edges).toHaveLength(0);
  });

  it('rechaza (todo-o-nada) un tipo de nodo desconocido', () => {
    const cs = parseChangeSet({
      summary: 'x',
      changes: [
        { op: 'add_node', nodeType: 'logic.condition', name: 'ok' },
        { op: 'add_node', nodeType: 'no.existe', name: 'malo' },
      ],
    });
    if (!cs.ok) throw new Error('inválido');
    const result = applyChangeSet(graphWith([trigger]), cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(false);
    expect(result.graph).toBeUndefined();
    expect(result.errors.join(' ')).toContain('no.existe');
  });

  it('rechaza una conexión a un nodo inexistente', () => {
    const cs = parseChangeSet({ summary: 'x', changes: [{ op: 'add_edge', from: 't1', to: 'fantasma' }] });
    if (!cs.ok) throw new Error('inválido');
    const result = applyChangeSet(graphWith([trigger]), cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toContain('fantasma');
  });

  it('no duplica conexiones idénticas', () => {
    const respond = { ...trigger, id: 'r1', type: 'communication.respond', name: 'R', config: {} };
    const graph = graphWith([trigger, respond], [
      { id: 'e1', source: 't1', sourcePort: 'main', target: 'r1', targetPort: 'main' },
    ]);
    const cs = parseChangeSet({ summary: 'x', changes: [{ op: 'add_edge', from: 't1', to: 'r1' }] });
    if (!cs.ok) throw new Error('inválido');
    const result = applyChangeSet(graph, cs.changeSet, resolve, counterGen());
    expect(result.ok).toBe(true);
    expect(result.graph!.edges).toHaveLength(1);
  });
});
