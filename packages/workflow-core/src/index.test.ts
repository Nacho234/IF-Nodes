import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineNode, NodeExecutionError, type NodeDefinition } from '@ifnodes/node-definitions';
import type { WorkflowGraph } from '@ifnodes/shared';
import { executeWorkflow, type ExecuteWorkflowOptions } from './index';

/* ── Definiciones de prueba (independientes del set real) ───── */

const testTrigger = defineNode<{ payload?: string }, unknown, Record<string, unknown>>({
  type: 'test.trigger',
  version: 1,
  category: 'trigger',
  displayName: 'Trigger',
  description: '',
  icon: 'play',
  configSchema: z.object({ payload: z.string().optional() }),
  defaultConfig: {},
  uiHints: [],
  inputs: [],
  outputs: [{ id: 'main', label: 'out' }],
  exportable: true,
  async execute({ input }) {
    return { output: (input as Record<string, unknown>) ?? {} };
  },
});

const echo = defineNode<{ text: string }, unknown, { text: string }>({
  type: 'test.echo',
  version: 1,
  category: 'data',
  displayName: 'Echo',
  description: '',
  icon: 'shuffle',
  configSchema: z.object({ text: z.string() }),
  defaultConfig: { text: '' },
  uiHints: [],
  inputs: [{ id: 'main', label: 'in' }],
  outputs: [{ id: 'main', label: 'out' }],
  exportable: true,
  async execute({ config }) {
    return { output: { text: config.text } };
  },
});

let failCount = 0;
const flaky = defineNode<{ failTimes: number }, unknown, { ok: boolean }>({
  type: 'test.flaky',
  version: 1,
  category: 'data',
  displayName: 'Flaky',
  description: '',
  icon: 'shuffle',
  configSchema: z.object({ failTimes: z.number() }),
  defaultConfig: { failTimes: 0 },
  uiHints: [],
  inputs: [{ id: 'main', label: 'in' }],
  outputs: [{ id: 'main', label: 'out' }],
  exportable: true,
  async execute({ config }) {
    if (failCount < config.failTimes) {
      failCount++;
      throw new NodeExecutionError('FLAKY', 'fallo transitorio', { retryable: true });
    }
    return { output: { ok: true } };
  },
});

const boom = defineNode<Record<string, never>, unknown, never>({
  type: 'test.boom',
  version: 1,
  category: 'data',
  displayName: 'Boom',
  description: '',
  icon: 'shuffle',
  configSchema: z.object({}),
  defaultConfig: {},
  uiHints: [],
  inputs: [{ id: 'main', label: 'in' }],
  outputs: [{ id: 'main', label: 'out' }, { id: 'error', label: 'error' }],
  exportable: true,
  async execute() {
    throw new NodeExecutionError('BOOM', 'explotó', { retryable: false });
  },
});

const branch = defineNode<{ value: string }, unknown, unknown>({
  type: 'test.branch',
  version: 1,
  category: 'logic',
  displayName: 'Branch',
  description: '',
  icon: 'git-fork',
  configSchema: z.object({ value: z.string() }),
  defaultConfig: { value: '' },
  uiHints: [],
  inputs: [{ id: 'main', label: 'in' }],
  outputs: [
    { id: 'true', label: 'sí' },
    { id: 'false', label: 'no' },
  ],
  exportable: true,
  async execute({ config, input }) {
    const port = config.value === 'yes' ? 'true' : 'false';
    return { outputsByPort: { [port]: input } };
  },
});

const slow = defineNode<{ ms: number }, unknown, { done: boolean }>({
  type: 'test.slow',
  version: 1,
  category: 'data',
  displayName: 'Slow',
  description: '',
  icon: 'shuffle',
  configSchema: z.object({ ms: z.number() }),
  defaultConfig: { ms: 0 },
  uiHints: [],
  inputs: [{ id: 'main', label: 'in' }],
  outputs: [{ id: 'main', label: 'out' }],
  exportable: true,
  async execute({ config }) {
    await new Promise((resolve) => setTimeout(resolve, config.ms));
    return { output: { done: true } };
  },
});

const DEFS = new Map<string, NodeDefinition>(
  ([testTrigger, echo, flaky, boom, branch, slow] as unknown as NodeDefinition[]).map((def) => [
    def.type,
    def,
  ]),
);

function node(id: string, type: string, config: Record<string, unknown> = {}, extra: Partial<WorkflowGraph['nodes'][number]> = {}) {
  return {
    id,
    type,
    nodeVersion: 1,
    name: id,
    position: { x: 0, y: 0 },
    config,
    disabled: false,
    notes: '',
    ...extra,
  };
}

function edge(id: string, source: string, target: string, sourcePort = 'main') {
  return { id, source, sourcePort, target, targetPort: 'main' };
}

function run(graph: WorkflowGraph, overrides: Partial<ExecuteWorkflowOptions> = {}) {
  return executeWorkflow({
    graph,
    ids: { executionId: 'e1', projectId: 'p1', workflowId: 'w1', versionId: null },
    trigger: { text: 'hola' },
    resolveDefinition: (type) => DEFS.get(type),
    ...overrides,
  });
}

const graph = (nodes: WorkflowGraph['nodes'], edges: WorkflowGraph['edges']): WorkflowGraph => ({
  nodes,
  edges,
  stickyNotes: [],
  groups: [],
});

/* ── Tests ──────────────────────────────────────────────────── */

describe('executeWorkflow — flujo lineal', () => {
  it('ejecuta trigger → echo y resuelve expresiones del contexto', async () => {
    const result = await run(
      graph(
        [node('t', 'test.trigger'), node('e', 'test.echo', { text: 'dijo: {{trigger.text}}' })],
        [edge('1', 't', 'e')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.steps.map((step) => step.status)).toEqual(['SUCCEEDED', 'SUCCEEDED']);
    expect(result.finalOutput).toEqual({ text: 'dijo: hola' });
    expect(result.context.nodeOutputs['e']).toEqual({ text: 'dijo: hola' });
  });

  it('las salidas de nodos anteriores están disponibles vía nodes.<id>.output', async () => {
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node('a', 'test.echo', { text: 'primero' }),
          node('b', 'test.echo', { text: 'antes fue {{nodes.a.output.text}}' }),
        ],
        [edge('1', 't', 'a'), edge('2', 'a', 'b')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.finalOutput).toEqual({ text: 'antes fue primero' });
  });

  it('registra input/output/duración por paso', async () => {
    const result = await run(
      graph([node('t', 'test.trigger'), node('e', 'test.echo', { text: 'x' })], [edge('1', 't', 'e')]),
    );
    const step = result.steps[1];
    expect(step?.input).toEqual({ text: 'hola' });
    expect(step?.output).toEqual({ text: 'x' });
    expect(step?.durationMs).toBeGreaterThanOrEqual(0);
    expect(step?.order).toBe(1);
  });
});

describe('executeWorkflow — ramas', () => {
  const branchGraph = (value: string) =>
    graph(
      [
        node('t', 'test.trigger'),
        node('b', 'test.branch', { value }),
        node('yes', 'test.echo', { text: 'rama sí' }),
        node('no', 'test.echo', { text: 'rama no' }),
      ],
      [edge('1', 't', 'b'), edge('2', 'b', 'yes', 'true'), edge('3', 'b', 'no', 'false')],
    );

  it('condición verdadera sigue solo la rama true', async () => {
    const result = await run(branchGraph('yes'));
    expect(result.status).toBe('SUCCEEDED');
    const executed = result.steps.map((step) => step.nodeId);
    expect(executed).toContain('yes');
    expect(executed).not.toContain('no');
  });

  it('condición falsa sigue solo la rama false', async () => {
    const result = await run(branchGraph('other'));
    const executed = result.steps.map((step) => step.nodeId);
    expect(executed).toContain('no');
    expect(executed).not.toContain('yes');
  });
});

describe('executeWorkflow — errores', () => {
  it('estrategia stop (default): la ejecución falla y marca el nodo', async () => {
    const result = await run(
      graph(
        [node('t', 'test.trigger'), node('x', 'test.boom'), node('after', 'test.echo', { text: 'no llega' })],
        [edge('1', 't', 'x'), edge('2', 'x', 'after')],
      ),
    );
    expect(result.status).toBe('FAILED');
    expect(result.failedNodeId).toBe('x');
    expect(result.error?.code).toBe('BOOM');
    expect(result.steps.map((step) => step.nodeId)).not.toContain('after');
  });

  it('estrategia continue: el flujo sigue con la entrada original', async () => {
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node('x', 'test.boom', {}, { errorPolicy: { strategy: 'continue' } }),
          node('after', 'test.echo', { text: 'llegué' }),
        ],
        [edge('1', 't', 'x'), edge('2', 'x', 'after')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.steps.find((step) => step.nodeId === 'x')?.status).toBe('FAILED');
    expect(result.finalOutput).toEqual({ text: 'llegué' });
  });

  it('estrategia fallback: usa el valor alternativo', async () => {
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node('x', 'test.boom', {}, { errorPolicy: { strategy: 'fallback', fallbackValue: { text: 'plan B' } } }),
          node('after', 'test.echo', { text: '{{nodes.x.output.text}}' }),
        ],
        [edge('1', 't', 'x'), edge('2', 'x', 'after')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.finalOutput).toEqual({ text: 'plan B' });
  });

  it('estrategia error-output: enruta por el puerto error', async () => {
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node('x', 'test.boom', {}, { errorPolicy: { strategy: 'error-output' } }),
          node('ok', 'test.echo', { text: 'ok' }),
          node('handler', 'test.echo', { text: 'capturado: {{input.error.code}}' }),
        ],
        [edge('1', 't', 'x'), edge('2', 'x', 'ok', 'main'), edge('3', 'x', 'handler', 'error')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    const executed = result.steps.map((step) => step.nodeId);
    expect(executed).toContain('handler');
    expect(executed).not.toContain('ok');
    expect(result.finalOutput).toEqual({ text: 'capturado: BOOM' });
  });

  it('reintentos: el nodo flaky pasa al segundo intento', async () => {
    failCount = 0;
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node(
            'f',
            'test.flaky',
            { failTimes: 1 },
            { errorPolicy: { strategy: 'retry', retries: 2, retryDelayMs: 5, backoff: 'fixed' } },
          ),
        ],
        [edge('1', 't', 'f')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.steps.find((step) => step.nodeId === 'f')?.attempt).toBe(2);
  });

  it('reintentos agotados: la ejecución falla', async () => {
    failCount = 0;
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node(
            'f',
            'test.flaky',
            { failTimes: 10 },
            { errorPolicy: { strategy: 'retry', retries: 2, retryDelayMs: 5, backoff: 'fixed' } },
          ),
        ],
        [edge('1', 't', 'f')],
      ),
    );
    expect(result.status).toBe('FAILED');
    expect(result.steps.find((step) => step.nodeId === 'f')?.attempt).toBe(3);
  });

  it('config inválida tras resolver expresiones falla con claridad', async () => {
    const result = await run(
      graph(
        [node('t', 'test.trigger'), node('s', 'test.slow', { ms: 'no-numérico' })],
        [edge('1', 't', 's')],
      ),
    );
    expect(result.status).toBe('FAILED');
    expect(result.failedNodeId).toBe('s');
  });
});

describe('executeWorkflow — límites y control', () => {
  it('timeout por nodo', async () => {
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node('s', 'test.slow', { ms: 500 }, { errorPolicy: { strategy: 'stop', timeoutMs: 100 } }),
        ],
        [edge('1', 't', 's')],
      ),
    );
    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('NODE_TIMEOUT');
  });

  it('timeout global de la ejecución', async () => {
    const result = await run(
      graph(
        [node('t', 'test.trigger'), node('a', 'test.slow', { ms: 120 }), node('b', 'test.slow', { ms: 120 })],
        [edge('1', 't', 'a'), edge('2', 'a', 'b')],
      ),
      { limits: { maxDurationMs: 150 } },
    );
    expect(result.status).toBe('TIMED_OUT');
  });

  it('cancelación por señal', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const result = await run(
      graph(
        [node('t', 'test.trigger'), node('s', 'test.slow', { ms: 5000 })],
        [edge('1', 't', 's')],
      ),
      { signal: controller.signal },
    );
    expect(result.status).toBe('CANCELLED');
  });

  it('nodo desactivado se saltea propagando la entrada', async () => {
    const result = await run(
      graph(
        [
          node('t', 'test.trigger'),
          node('off', 'test.boom', {}, { disabled: true }),
          node('after', 'test.echo', { text: 'pasé: {{input.text}}' }),
        ],
        [edge('1', 't', 'off'), edge('2', 'off', 'after')],
      ),
    );
    expect(result.status).toBe('SUCCEEDED');
    expect(result.steps.find((step) => step.nodeId === 'off')?.status).toBe('SKIPPED');
    expect(result.finalOutput).toEqual({ text: 'pasé: hola' });
  });

  it('grafo sin trigger falla en la validación', async () => {
    const result = await run(graph([node('e', 'test.echo', { text: 'x' })], []));
    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('GRAPH_INVALID');
  });

  it('tipo de nodo desconocido falla con código claro', async () => {
    const result = await run(
      graph([node('t', 'test.trigger'), node('x', 'test.inexistente')], [edge('1', 't', 'x')]),
    );
    expect(result.status).toBe('FAILED');
    expect(result.error?.code).toBe('NODE_TYPE_UNKNOWN');
  });

  it('emite hooks por paso en orden', async () => {
    const events: string[] = [];
    await run(
      graph([node('t', 'test.trigger'), node('e', 'test.echo', { text: 'x' })], [edge('1', 't', 'e')]),
      {
        hooks: {
          onStepStart: (step) => void events.push(`start:${step.nodeId}`),
          onStepFinish: (step) => void events.push(`finish:${step.nodeId}:${step.status}`),
        },
      },
    );
    expect(events).toEqual(['start:t', 'finish:t:SUCCEEDED', 'start:e', 'finish:e:SUCCEEDED']);
  });
});
