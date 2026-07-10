import { describe, expect, it } from 'vitest';
import { nodeRegistry } from './registry';
import { manualTriggerNode } from './nodes/trigger/manual-trigger';
import { transformNode } from './nodes/data/transform';
import { respondNode } from './nodes/communication/respond';
import type { NodeExecutionContext, NodeLogger } from './contract';

const silentLogger: NodeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function contextWith<TConfig, TInput>(config: TConfig, input: TInput): NodeExecutionContext<TConfig, TInput> {
  return {
    config,
    input,
    nodeId: 'test-node',
    executionId: 'test-exec',
    logger: silentLogger,
    signal: new AbortController().signal,
    services: {},
  };
}

describe('nodeRegistry', () => {
  it('registra los tres nodos demo', () => {
    const types = nodeRegistry.all().map((d) => d.type);
    expect(types).toContain('trigger.manual');
    expect(types).toContain('data.transform');
    expect(types).toContain('communication.respond');
  });

  it('identifica triggers por categoría', () => {
    expect(nodeRegistry.isTrigger('trigger.manual')).toBe(true);
    expect(nodeRegistry.isTrigger('data.transform')).toBe(false);
    expect(nodeRegistry.isTrigger('desconocido')).toBe(false);
  });

  it('valida defaultConfig contra el propio configSchema de cada nodo', () => {
    for (const def of nodeRegistry.all()) {
      expect(def.configSchema.safeParse(def.defaultConfig).success).toBe(true);
    }
  });
});

describe('trigger.manual', () => {
  it('devuelve el payload de ejemplo parseado', async () => {
    const config = manualTriggerNode.configSchema.parse({ samplePayloadJson: '{"text":"hola"}' });
    const result = await manualTriggerNode.execute(contextWith(config, undefined));
    expect(result).toEqual({ output: { text: 'hola' } });
  });

  it('prioriza un payload real de entrada (simulador)', async () => {
    const config = manualTriggerNode.configSchema.parse({ samplePayloadJson: '{"text":"hola"}' });
    const result = await manualTriggerNode.execute(contextWith(config, { text: 'real' }));
    expect(result).toEqual({ output: { text: 'real' } });
  });

  it('rechaza JSON inválido en el schema', () => {
    expect(manualTriggerNode.configSchema.safeParse({ samplePayloadJson: '{oops' }).success).toBe(false);
  });
});

describe('data.transform', () => {
  it('asigna claves simples y con path anidado', async () => {
    const config = transformNode.configSchema.parse({
      assignments: [
        { key: 'greeting', value: 'Hola' },
        { key: 'contact.name', value: 'Nico' },
      ],
      keepInput: false,
    });
    const result = await transformNode.execute(contextWith(config, { previo: 1 }));
    expect(result).toEqual({ output: { greeting: 'Hola', contact: { name: 'Nico' } } });
  });

  it('conserva la entrada cuando keepInput es true', async () => {
    const config = transformNode.configSchema.parse({
      assignments: [{ key: 'greeting', value: 'Hola' }],
      keepInput: true,
    });
    const result = await transformNode.execute(contextWith(config, { text: 'algo' }));
    expect(result).toEqual({ output: { text: 'algo', greeting: 'Hola' } });
  });

  it('rechaza claves inválidas', () => {
    const parsed = transformNode.configSchema.safeParse({
      assignments: [{ key: '1 mala clave!', value: 'x' }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe('communication.respond', () => {
  it('devuelve el mensaje configurado', async () => {
    const config = respondNode.configSchema.parse({ message: 'Listo' });
    const result = await respondNode.execute(contextWith(config, {}));
    expect(result).toEqual({ output: { message: 'Listo' } });
  });
});
