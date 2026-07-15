import { describe, expect, it } from 'vitest';
import { escalateNode } from './escalate';
import { nodeRegistry } from '../../registry';
import type {
  ConversationTurn,
  MemoryService,
  NodeExecutionContext,
  NodeLogger,
  NodeServices,
} from '../../contract';

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeMemory() {
  const status = new Map<string, string>();
  const saved: ConversationTurn[] = [];
  const key = (i: { channel: string; contact: string }) => `${i.channel}:${i.contact}`;
  const service: MemoryService = {
    async loadHistory(i) {
      return { conversationId: key(i), turns: saved, transcript: '', status: status.get(key(i)) ?? 'open' };
    },
    async saveTurn(i) {
      saved.push({ role: i.role, text: i.text });
      return { conversationId: key(i) };
    },
    async setStatus(i) {
      status.set(key(i), i.status);
      return { conversationId: key(i) };
    },
  };
  return { service, status, saved };
}

function ctx<C>(config: C, services: NodeServices): NodeExecutionContext<C, unknown> {
  return { config, input: { keep: true }, nodeId: 'n', executionId: 'e', logger: silentLogger, signal: new AbortController().signal, services };
}

describe('nodo Escalar a humano', () => {
  it('está registrado', () => {
    expect(nodeRegistry.all().map((d) => d.type)).toContain('communication.escalate');
  });

  it('marca la conversación como handoff, guarda la nota y pasa la entrada', async () => {
    const mem = fakeMemory();
    const result = await escalateNode.execute(
      ctx({ channel: 'whatsapp', contact: '549341', status: 'handoff', note: 'pidió reunión' }, { memory: mem.service }),
    );
    expect(mem.status.get('whatsapp:549341')).toBe('handoff');
    expect(mem.saved.some((t) => t.role === 'system' && t.text === 'pidió reunión')).toBe(true);
    const output = (result as { output: { status: string; keep: boolean } }).output;
    expect(output.status).toBe('handoff');
    expect(output.keep).toBe(true);
  });
});
