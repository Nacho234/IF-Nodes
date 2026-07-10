import { describe, expect, it } from 'vitest';
import {
  validateGraphStructure,
  workflowGraphSchema,
  type WorkflowGraph,
} from './workflow-graph';

const isTrigger = (type: string) => type.startsWith('trigger.');

function node(id: string, type: string, overrides: Partial<WorkflowGraph['nodes'][number]> = {}) {
  return {
    id,
    type,
    nodeVersion: 1,
    name: id,
    position: { x: 0, y: 0 },
    config: {},
    disabled: false,
    notes: '',
    ...overrides,
  };
}

function edge(id: string, source: string, target: string, sourcePort = 'main') {
  return { id, source, sourcePort, target, targetPort: 'main' };
}

describe('workflowGraphSchema', () => {
  it('acepta un grafo válido y aplica defaults', () => {
    const parsed = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual')],
      edges: [],
    });
    expect(parsed.stickyNotes).toEqual([]);
    expect(parsed.groups).toEqual([]);
  });

  it('rechaza ids de nodo duplicados', () => {
    const result = workflowGraphSchema.safeParse({
      nodes: [node('a', 'trigger.manual'), node('a', 'data.transform')],
      edges: [],
    });
    expect(result.success).toBe(false);
  });

  it('rechaza conexiones hacia nodos inexistentes', () => {
    const result = workflowGraphSchema.safeParse({
      nodes: [node('a', 'trigger.manual')],
      edges: [edge('e1', 'a', 'ghost')],
    });
    expect(result.success).toBe(false);
  });
});

describe('validateGraphStructure', () => {
  it('marca error cuando no hay disparador', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('t', 'data.transform')],
      edges: [],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    expect(issues.some((i) => i.code === 'NO_TRIGGER' && i.level === 'error')).toBe(true);
  });

  it('marca error con más de un disparador activo', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual'), node('b', 'trigger.manual')],
      edges: [],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    expect(issues.some((i) => i.code === 'MULTIPLE_TRIGGERS')).toBe(true);
  });

  it('permite un segundo disparador desactivado', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual'), node('b', 'trigger.manual', { disabled: true })],
      edges: [],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    expect(issues.some((i) => i.code === 'MULTIPLE_TRIGGERS')).toBe(false);
  });

  it('detecta nodos no alcanzables desde el disparador', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual'), node('b', 'data.transform'), node('c', 'data.transform')],
      edges: [edge('e1', 'a', 'b')],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    const disconnected = issues.filter((i) => i.code === 'DISCONNECTED_NODE');
    expect(disconnected).toHaveLength(1);
    expect(disconnected[0]?.nodeId).toBe('c');
  });

  it('detecta ciclos', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual'), node('b', 'data.transform'), node('c', 'data.transform')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'b')],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    expect(issues.some((i) => i.code === 'CYCLE_DETECTED' && i.level === 'error')).toBe(true);
  });

  it('marca conexiones duplicadas como warning', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual'), node('b', 'data.transform')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'b')],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    expect(issues.some((i) => i.code === 'DUPLICATE_EDGE' && i.level === 'warning')).toBe(true);
  });

  it('devuelve sin errores un flujo lineal correcto', () => {
    const graph = workflowGraphSchema.parse({
      nodes: [node('a', 'trigger.manual'), node('b', 'data.transform'), node('c', 'communication.respond')],
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    });
    const issues = validateGraphStructure(graph, isTrigger);
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(0);
  });
});
