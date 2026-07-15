import { describe, expect, it } from 'vitest';
import { aiAgentNode } from './agent';
import { NodeExecutionError } from '../../contract';
import type {
  AIChatInput,
  AIChatResult,
  AIService,
  HttpRequestInput,
  HttpResult,
  NodeExecutionContext,
  NodeLogger,
  NodeServices,
} from '../../contract';

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** AIService con respuestas de chat pre-programadas (para simular el loop). */
function scriptedAi(script: Partial<AIChatResult>[]): AIService {
  let i = 0;
  return {
    generateText: async () => ({ text: '', provider: 'x', model: 'x', inputTokens: 0, outputTokens: 0 }),
    classify: async () => ({ category: 'x', provider: 'x', model: 'x' }),
    async chat(_input: AIChatInput): Promise<AIChatResult> {
      const step = script[Math.min(i, script.length - 1)] ?? {};
      i += 1;
      return {
        text: '',
        toolCalls: [],
        stopReason: 'end_turn',
        provider: 'anthropic',
        model: 'claude',
        inputTokens: 10,
        outputTokens: 5,
        ...step,
      };
    },
  };
}

function fakeHttp(body: unknown): NonNullable<NodeServices['http']> {
  return {
    async request(_input: HttpRequestInput): Promise<HttpResult> {
      return { status: 200, ok: true, headers: {}, body };
    },
  };
}

function ctx(config: unknown, services: NodeServices): NodeExecutionContext<never, never> {
  return {
    config: config as never,
    input: {} as never,
    nodeId: 'n',
    executionId: 'e',
    logger: silentLogger,
    signal: new AbortController().signal,
    services,
  };
}

const baseConfig = {
  credentialId: '',
  model: '',
  system: 'sos un agente',
  objective: '¿cuánto sale el SKU A?',
  maxSteps: 5,
  maxTokens: 1024,
  enableHttp: false,
  enableMemory: false,
  memoryChannel: 'whatsapp',
  memoryContact: 'c',
  tools: [
    { name: 'get_price', description: 'precio de un SKU', method: 'GET' as const, url: 'https://api.demo/price', send: 'query' as const, credentialId: '' },
  ],
};

describe('nodo Agente', () => {
  it('está registrado', async () => {
    const { nodeRegistry } = await import('../../registry');
    expect(nodeRegistry.all().map((d) => d.type)).toContain('ai.agent');
  });

  it('corre el loop: usa una herramienta y devuelve la respuesta final', async () => {
    const ai = scriptedAi([
      { text: '', toolCalls: [{ id: 't1', name: 'get_price', input: { sku: 'A' } }] },
      { text: 'El SKU A sale $100.', toolCalls: [] },
    ]);
    const result = await aiAgentNode.execute(ctx(baseConfig, { ai, http: fakeHttp({ price: 100 }) }));
    const output = (result as { output: { text: string; steps: unknown[]; stepsUsed: number } }).output;
    expect(output.text).toBe('El SKU A sale $100.');
    expect(output.steps).toHaveLength(1);
    expect((output.steps[0] as { tool: string }).tool).toBe('get_price');
    expect(output.stepsUsed).toBe(2);
  });

  it('respeta el límite de pasos (no loopea infinito)', async () => {
    // El modelo pide herramienta siempre → debe cortar en maxSteps
    const ai = scriptedAi([{ text: '', toolCalls: [{ id: 't', name: 'get_price', input: {} }] }]);
    const result = await aiAgentNode.execute(ctx({ ...baseConfig, maxSteps: 3 }, { ai, http: fakeHttp({}) }));
    const output = (result as { output: { stepsUsed: number; text: string } }).output;
    expect(output.stepsUsed).toBe(3);
    expect(output.text).toContain('límite de pasos');
  });

  it('marca la herramienta como error si el nombre no existe', async () => {
    const ai = scriptedAi([
      { text: '', toolCalls: [{ id: 't1', name: 'no_existe', input: {} }] },
      { text: 'listo', toolCalls: [] },
    ]);
    const result = await aiAgentNode.execute(ctx(baseConfig, { ai, http: fakeHttp({}) }));
    const output = (result as { output: { steps: { isError: boolean }[] } }).output;
    expect(output.steps[0]!.isError).toBe(true);
  });

  it('sin herramientas responde en un paso', async () => {
    const ai = scriptedAi([{ text: 'Hola, soy el agente.', toolCalls: [] }]);
    const result = await aiAgentNode.execute(ctx({ ...baseConfig, tools: [] }, { ai }));
    const output = (result as { output: { text: string; stepsUsed: number } }).output;
    expect(output.text).toBe('Hola, soy el agente.');
    expect(output.stepsUsed).toBe(1);
  });

  it('sin servicio de IA lanza error claro', async () => {
    await expect(aiAgentNode.execute(ctx(baseConfig, {}))).rejects.toBeInstanceOf(NodeExecutionError);
  });
});
