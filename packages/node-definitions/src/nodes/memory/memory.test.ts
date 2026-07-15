import { describe, expect, it } from 'vitest';
import { memoryLoadHistoryNode } from './load-history';
import { memorySaveTurnNode } from './save-turn';
import { nodeRegistry } from '../../registry';
import type {
  ConversationTurn,
  MemoryLoadInput,
  MemoryService,
  NodeExecutionContext,
  NodeLogger,
  NodeServices,
} from '../../contract';

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** Memoria falsa en un Map para probar los nodos sin DB. */
function fakeMemory(): MemoryService & { dump: (k: string) => ConversationTurn[] } {
  const store = new Map<string, ConversationTurn[]>();
  const key = (i: { channel: string; contact: string }) => `${i.channel}:${i.contact}`;
  return {
    dump: (k) => store.get(k) ?? [],
    async loadHistory(input: MemoryLoadInput) {
      const all = store.get(key(input)) ?? [];
      const turns = all.slice(-(input.limit ?? 10));
      return {
        conversationId: key(input),
        turns,
        transcript: turns.map((t) => `${t.role}: ${t.text}`).join('\n'),
        status: 'open',
      };
    },
    async saveTurn(input) {
      const k = key(input);
      const arr = store.get(k) ?? [];
      arr.push({ role: input.role, text: input.text });
      store.set(k, arr);
      return { conversationId: k };
    },
    async setStatus(input) {
      return { conversationId: key(input) };
    },
  };
}

function ctx<C, I>(config: C, input: I, services: NodeServices): NodeExecutionContext<C, I> {
  return { config, input, nodeId: 'n', executionId: 'e', logger: silentLogger, signal: new AbortController().signal, services };
}

describe('nodos de memoria', () => {
  it('están registrados', () => {
    const types = nodeRegistry.all().map((d) => d.type);
    expect(types).toContain('memory.load-history');
    expect(types).toContain('memory.save-turn');
  });

  it('guardar turno persiste y cargar historial lo devuelve', async () => {
    const memory = fakeMemory();
    const services = { memory };
    // guardar dos turnos
    await memorySaveTurnNode.execute(
      ctx({ channel: 'whatsapp', contact: '549341', role: 'user' as const, text: 'hola' }, {}, services),
    );
    await memorySaveTurnNode.execute(
      ctx({ channel: 'whatsapp', contact: '549341', role: 'assistant' as const, text: '¡hola! ¿en qué te ayudo?' }, {}, services),
    );
    // cargar
    const result = await memoryLoadHistoryNode.execute(
      ctx({ channel: 'whatsapp', contact: '549341', limit: 10 }, {}, services),
    );
    const output = (result as { output: { transcript: string; turns: ConversationTurn[] } }).output;
    expect(output.turns).toHaveLength(2);
    expect(output.transcript).toContain('hola');
    expect(output.transcript).toContain('¿en qué te ayudo?');
  });

  it('guardar turno pasa la entrada intacta y suma conversationId', async () => {
    const services = { memory: fakeMemory() };
    const result = await memorySaveTurnNode.execute(
      ctx({ channel: 'whatsapp', contact: 'c', role: 'user' as const, text: 'x' }, { text: 'x', phone: 'c' }, services),
    );
    const output = (result as { output: Record<string, unknown> }).output;
    expect(output.text).toBe('x');
    expect(output.conversationId).toBeTruthy();
  });

  it('sin servicio de memoria degradan sin romper', async () => {
    const load = await memoryLoadHistoryNode.execute(ctx({ channel: 'whatsapp', contact: 'c', limit: 5 }, {}, {}));
    expect((load as { output: { turns: unknown[] } }).output.turns).toEqual([]);
    const save = await memorySaveTurnNode.execute(
      ctx({ channel: 'whatsapp', contact: 'c', role: 'user' as const, text: 'x' }, { keep: true }, {}),
    );
    expect((save as { output: Record<string, unknown> }).output.keep).toBe(true);
  });
});
