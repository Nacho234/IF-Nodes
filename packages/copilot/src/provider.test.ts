import { describe, expect, it } from 'vitest';
import {
  ClaudeCopilotProvider,
  createCopilotProvider,
  DevCopilotProvider,
  estimateCopilotCost,
} from './provider';

describe('createCopilotProvider', () => {
  it('devuelve el proveedor dev cuando no hay API key', () => {
    const provider = createCopilotProvider({ provider: 'claude' });
    expect(provider).toBeInstanceOf(DevCopilotProvider);
    expect(provider.isReal).toBe(false);
  });

  it('devuelve el proveedor Claude cuando hay API key', () => {
    const provider = createCopilotProvider({ provider: 'claude', apiKey: 'sk-test' });
    expect(provider).toBeInstanceOf(ClaudeCopilotProvider);
    expect(provider.isReal).toBe(true);
    expect(provider.model).toBe('claude-opus-4-8');
  });
});

describe('DevCopilotProvider', () => {
  it('responde y hace streaming del texto', async () => {
    const provider = new DevCopilotProvider();
    const chunks: string[] = [];
    const result = await provider.chat(
      { system: 'sys', messages: [{ role: 'user', content: 'hola copilot' }] },
      { onText: (delta) => chunks.push(delta) },
    );
    expect(result.text).toContain('hola copilot');
    expect(chunks.join('')).toContain('hola copilot');
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.proposalRaw).toBeUndefined();
  });
});

describe('estimateCopilotCost', () => {
  it('estima costo de opus por prefijo de modelo', () => {
    // 1M in + 1M out en opus = 5 + 25 = 30
    expect(estimateCopilotCost('claude-opus-4-8', 1_000_000, 1_000_000)).toBeCloseTo(30);
  });

  it('modelo desconocido cuesta 0', () => {
    expect(estimateCopilotCost('mistery-model', 1000, 1000)).toBe(0);
  });
});
