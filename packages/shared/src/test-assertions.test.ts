import { describe, expect, it } from 'vitest';
import {
  evaluateAssertions,
  type ExecutionSummaryForAssertions,
  type TestAssertion,
} from './test-assertions';

const execution: ExecutionSummaryForAssertions = {
  status: 'SUCCEEDED',
  finalOutput: { message: 'Hola Nico, tu turno quedó reservado', total: 3 },
  nodeOutputs: {
    node_intent: { true: { text: 'quiero un turno' } },
    node_resp: { message: 'Hola Nico, tu turno quedó reservado' },
  },
  visitedNodeIds: ['node_wa_in', 'node_intent', 'node_resp'],
  variables: { empresa: 'Dermafisherton' },
  trigger: { text: 'quiero un turno', name: 'Nico' },
};

function assertion(partial: Partial<TestAssertion> & { kind: TestAssertion['kind'] }): TestAssertion {
  return { id: 'a1', path: '', expected: '', nodeId: '', ...partial };
}

function evalOne(partial: Partial<TestAssertion> & { kind: TestAssertion['kind'] }) {
  const results = evaluateAssertions([assertion(partial)], execution);
  return results[0]!;
}

describe('evaluateAssertions', () => {
  it('finalStatus', () => {
    expect(evalOne({ kind: 'finalStatus', expected: 'SUCCEEDED' }).passed).toBe(true);
    expect(evalOne({ kind: 'finalStatus', expected: 'FAILED' }).passed).toBe(false);
  });

  it('nodeVisited / nodeNotVisited', () => {
    expect(evalOne({ kind: 'nodeVisited', nodeId: 'node_intent' }).passed).toBe(true);
    expect(evalOne({ kind: 'nodeVisited', nodeId: 'node_fantasma' }).passed).toBe(false);
    expect(evalOne({ kind: 'nodeNotVisited', nodeId: 'node_fantasma' }).passed).toBe(true);
    expect(evalOne({ kind: 'nodeNotVisited', nodeId: 'node_resp' }).passed).toBe(false);
  });

  it('contains sobre la salida final (sin distinguir mayúsculas)', () => {
    expect(evalOne({ kind: 'contains', path: 'output.message', expected: 'TURNO' }).passed).toBe(true);
    expect(evalOne({ kind: 'contains', path: 'output.message', expected: 'precio' }).passed).toBe(false);
  });

  it('equals con coerción numérica', () => {
    expect(evalOne({ kind: 'equals', path: 'output.total', expected: '3' }).passed).toBe(true);
    expect(evalOne({ kind: 'equals', path: 'output.total', expected: '4' }).passed).toBe(false);
  });

  it('exists / notExists sobre paths anidados y de nodos', () => {
    expect(evalOne({ kind: 'exists', path: 'nodes.node_resp.output.message' }).passed).toBe(true);
    expect(evalOne({ kind: 'exists', path: 'output.inexistente' }).passed).toBe(false);
    expect(evalOne({ kind: 'notExists', path: 'output.inexistente' }).passed).toBe(true);
  });

  it('type', () => {
    expect(evalOne({ kind: 'type', path: 'output.message', expected: 'string' }).passed).toBe(true);
    expect(evalOne({ kind: 'type', path: 'output.total', expected: 'number' }).passed).toBe(true);
    expect(evalOne({ kind: 'type', path: 'output', expected: 'array' }).passed).toBe(false);
  });

  it('greaterThan / lessThan con no numéricos', () => {
    expect(evalOne({ kind: 'greaterThan', path: 'output.total', expected: '2' }).passed).toBe(true);
    expect(evalOne({ kind: 'lessThan', path: 'output.total', expected: '2' }).passed).toBe(false);
    const nonNumeric = evalOne({ kind: 'greaterThan', path: 'output.message', expected: '2' });
    expect(nonNumeric.passed).toBe(false);
    expect(nonNumeric.message).toContain('no es numérico');
  });

  it('bloquea paths peligrosos', () => {
    expect(evalOne({ kind: 'exists', path: 'output.__proto__' }).passed).toBe(false);
    expect(evalOne({ kind: 'exists', path: 'constructor.prototype' }).passed).toBe(false);
  });

  it('variables y trigger accesibles', () => {
    expect(evalOne({ kind: 'equals', path: 'variables.empresa', expected: 'Dermafisherton' }).passed).toBe(true);
    expect(evalOne({ kind: 'contains', path: 'trigger.text', expected: 'turno' }).passed).toBe(true);
  });
});
