import { describe, expect, it } from 'vitest';
import type { WorkflowGraph } from '@ifnodes/shared';
import { REDACTED } from '@ifnodes/shared';
import { buildCopilotContext } from './context';

function graphWith(nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges'] = []): WorkflowGraph {
  return { nodes, edges, stickyNotes: [], groups: [] };
}

describe('buildCopilotContext', () => {
  it('incluye el catálogo de nodos registrados', () => {
    const ctx = buildCopilotContext({ graph: graphWith([]) });
    const catalog = ctx.redacted.availableNodes as { type: string }[];
    const types = catalog.map((n) => n.type);
    expect(types).toContain('trigger.manual');
    expect(types).toContain('logic.condition');
    expect(types).toContain('ai.generate');
    // marca los disparadores
    const manual = catalog.find((n) => n.type === 'trigger.manual') as { isTrigger: boolean };
    expect(manual.isTrigger).toBe(true);
  });

  it('redacta secretos en la config de los nodos', () => {
    const graph = graphWith([
      {
        id: 'n1',
        type: 'integrations.http-request',
        nodeVersion: 1,
        name: 'Llamar API',
        position: { x: 0, y: 0 },
        config: { url: 'https://api.x.com', apiKey: 'sk-super-secreto', authorization: 'Bearer abc' },
        disabled: false,
        notes: '',
      },
    ]);
    const ctx = buildCopilotContext({ graph });
    const flow = ctx.redacted.flow as { nodes: { config: Record<string, unknown> }[] };
    const config = flow.nodes[0]!.config;
    expect(config.apiKey).toBe(REDACTED);
    expect(config.authorization).toBe(REDACTED);
    expect(config.url).toBe('https://api.x.com');
    // y no debe filtrarse en el texto que va al modelo
    expect(ctx.text).not.toContain('sk-super-secreto');
    expect(ctx.text).toContain(REDACTED);
  });

  it('redacta input/output de la última ejecución', () => {
    const ctx = buildCopilotContext({
      graph: graphWith([]),
      lastExecution: {
        id: 'exec1',
        status: 'failed',
        error: 'boom',
        steps: [
          {
            nodeId: 'n1',
            status: 'error',
            output: { token: 'tok-secreto', ok: false },
          },
        ],
      },
    });
    const exec = ctx.redacted.lastExecution as { steps: { output: Record<string, unknown> }[] };
    expect(exec.steps[0]!.output.token).toBe(REDACTED);
    expect(ctx.text).not.toContain('tok-secreto');
  });

  it('marca el nodo seleccionado', () => {
    const graph = graphWith([
      { id: 'n1', type: 'trigger.manual', nodeVersion: 1, name: 'Inicio', position: { x: 0, y: 0 }, config: {}, disabled: false, notes: '' },
      { id: 'n2', type: 'communication.respond', nodeVersion: 1, name: 'Responder', position: { x: 1, y: 0 }, config: {}, disabled: false, notes: '' },
    ]);
    const ctx = buildCopilotContext({ graph, selectedNodeId: 'n2' });
    const selected = ctx.redacted.selectedNode as { id: string } | null;
    expect(selected?.id).toBe('n2');
  });
});
