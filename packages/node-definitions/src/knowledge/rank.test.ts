import { describe, expect, it } from 'vitest';
import { rankKnowledge } from './rank';
import { knowledgeSearchNode } from '../nodes/ai/knowledge-search';
import { nodeRegistry } from '../registry';
import {
  NodeExecutionError,
  type KnowledgeService,
  type NodeExecutionContext,
  type NodeLogger,
  type NodeServices,
} from '../contract';

const chunks = [
  { id: 'a', title: 'Precios', content: 'La inscripción cuesta 5000 pesos por categoría.' },
  { id: 'b', title: 'Plazos', content: 'El cierre de inscripción es el 30 de agosto.' },
  { id: 'c', title: 'Categorías', content: 'Hay tres categorías: cortometraje, documental y animación.' },
];

describe('rankKnowledge', () => {
  it('rankea por relevancia y arma el context', () => {
    const result = rankKnowledge(chunks, '¿cuánto cuesta la inscripción?', 2);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]!.id).toBe('a'); // "inscripción"/"cuesta" pegan con Precios
    expect(result.context).toContain('5000');
  });

  it('sin coincidencias devuelve vacío', () => {
    const result = rankKnowledge(chunks, 'xyzzy plutonio', 3);
    expect(result.hits).toHaveLength(0);
    expect(result.context).toBe('');
  });

  it('respeta el límite', () => {
    const result = rankKnowledge(chunks, 'inscripción categoría categorías', 1);
    expect(result.hits).toHaveLength(1);
  });
});

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };
function ctx<C>(config: C, services: NodeServices): NodeExecutionContext<C, unknown> {
  return { config, input: {}, nodeId: 'n', executionId: 'e', logger: silentLogger, signal: new AbortController().signal, services };
}

describe('nodo Buscar conocimiento', () => {
  it('está registrado', () => {
    expect(nodeRegistry.all().map((d) => d.type)).toContain('ai.knowledge-search');
  });

  it('devuelve context y found usando el servicio', async () => {
    const service: KnowledgeService = {
      async search(input) {
        return rankKnowledge(chunks, input.query, input.limit);
      },
    };
    const result = await knowledgeSearchNode.execute(ctx({ query: 'precios inscripción', limit: 3 }, { knowledge: service }));
    const output = (result as { output: { context: string; found: boolean } }).output;
    expect(output.found).toBe(true);
    expect(output.context).toContain('5000');
  });

  it('sin servicio lanza error', async () => {
    await expect(knowledgeSearchNode.execute(ctx({ query: 'x', limit: 3 }, {}))).rejects.toBeInstanceOf(NodeExecutionError);
  });
});
