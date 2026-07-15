import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@ifnodes/shared';
import { findExpressionIssues } from './expression-check';

const mk = (id: string, config: Record<string, unknown>) => ({
  id,
  type: 'data.transform',
  nodeVersion: 1,
  name: id,
  position: { x: 0, y: 0 },
  config,
  disabled: false,
  notes: '',
});
const graph = (nodes: WorkflowGraph['nodes']): WorkflowGraph => ({ nodes, edges: [], stickyNotes: [], groups: [] });

describe('findExpressionIssues', () => {
  it('marca atajos inexistentes ({{category}}, {{generate.text}})', () => {
    const issues = findExpressionIssues(graph([mk('a', { x: '{{category}}', y: '{{generate.text}}' })]));
    expect(issues.length).toBe(2);
    expect(issues.every((i) => i.message.includes('desconocida'))).toBe(true);
  });

  it('acepta referencias válidas', () => {
    const issues = findExpressionIssues(
      graph([
        mk('n1', {}),
        mk('b', { a: '{{trigger.text}}', c: '{{nodes.n1.output.text}}', d: '{{variables.x}}', e: '{{environment.API}}' }),
      ]),
    );
    expect(issues).toHaveLength(0);
  });

  it('marca referencia a un nodo inexistente', () => {
    const issues = findExpressionIssues(graph([mk('b', { a: '{{nodes.fantasma.output.text}}' })]));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain('inexistente');
  });

  it('permite funciones y valida el nodo interno', () => {
    const ok = findExpressionIssues(graph([mk('n1', {}), mk('b', { a: '{{default(nodes.n1.output.text, "x")}}' })]));
    expect(ok).toHaveLength(0);
    const bad = findExpressionIssues(graph([mk('b', { a: '{{default(nodes.ghost.output.text, "x")}}' })]));
    expect(bad).toHaveLength(1);
  });
});
