import { describe, expect, it } from 'vitest';
import { nodeRegistry } from './registry';
import { manualTriggerNode } from './nodes/trigger/manual-trigger';
import { webhookTriggerNode } from './nodes/trigger/webhook-trigger';
import { whatsappTriggerNode } from './nodes/trigger/whatsapp-trigger';
import { conditionNode } from './nodes/logic/condition';
import { switchNode } from './nodes/logic/switch';
import { setVariableNode } from './nodes/logic/set-variable';
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

describe('logic.condition', () => {
  const run = async (config: unknown, input: unknown = { paso: 1 }) => {
    const parsed = conditionNode.configSchema.parse(config);
    return conditionNode.execute(contextWith(parsed, input));
  };

  it('contains → true', async () => {
    expect(await run({ left: 'Quiero un turno', operator: 'contains', right: 'turno' })).toEqual({
      outputsByPort: { true: { paso: 1 } },
    });
  });

  it('contains → false (no distingue mayúsculas)', async () => {
    expect(await run({ left: 'Cuánto sale', operator: 'contains', right: 'TURNO' })).toEqual({
      outputsByPort: { false: { paso: 1 } },
    });
  });

  it('equals numérico', async () => {
    expect(await run({ left: '42', operator: 'equals', right: '42.0' })).toEqual({
      outputsByPort: { true: { paso: 1 } },
    });
  });

  it('exists / notExists', async () => {
    expect(await run({ left: '', operator: 'exists', right: '' })).toEqual({
      outputsByPort: { false: { paso: 1 } },
    });
    expect(await run({ left: 'undefined', operator: 'notExists', right: '' })).toEqual({
      outputsByPort: { true: { paso: 1 } },
    });
  });

  it('greaterThan / lessThan', async () => {
    expect(await run({ left: '10', operator: 'greaterThan', right: '5' })).toEqual({
      outputsByPort: { true: { paso: 1 } },
    });
    expect(await run({ left: '10', operator: 'lessThan', right: '5' })).toEqual({
      outputsByPort: { false: { paso: 1 } },
    });
  });
});

describe('logic.switch', () => {
  it('enruta por el caso coincidente', async () => {
    const config = switchNode.configSchema.parse({ value: 'ventas', case1: 'soporte', case2: 'Ventas' });
    expect(await switchNode.execute(contextWith(config, { x: 1 }))).toEqual({
      outputsByPort: { case2: { x: 1 } },
    });
  });

  it('sale por default si nada coincide', async () => {
    const config = switchNode.configSchema.parse({ value: 'otro', case1: 'a', case2: 'b', case3: '' });
    expect(await switchNode.execute(contextWith(config, { x: 1 }))).toEqual({
      outputsByPort: { default: { x: 1 } },
    });
  });
});

describe('logic.set-variable', () => {
  it('declara variables y deja pasar la entrada', async () => {
    const config = setVariableNode.configSchema.parse({
      assignments: [{ key: 'empresa', value: 'Dermafisherton' }],
    });
    expect(await setVariableNode.execute(contextWith(config, { in: true }))).toEqual({
      output: { in: true },
      variables: { empresa: 'Dermafisherton' },
    });
  });

  it('rechaza claves inválidas', () => {
    expect(
      setVariableNode.configSchema.safeParse({ assignments: [{ key: '1 mal', value: 'x' }] }).success,
    ).toBe(false);
  });
});

describe('trigger.whatsapp-message', () => {
  it('normaliza un mensaje real del simulador', async () => {
    const config = whatsappTriggerNode.configSchema.parse({});
    const result = await whatsappTriggerNode.execute(
      contextWith(config, { text: 'Hola', phone: '549341', name: 'Nico' }),
    );
    expect('output' in result && result.output).toMatchObject({
      text: 'Hola',
      phone: '549341',
      name: 'Nico',
      channel: 'whatsapp',
      messageType: 'text',
    });
  });

  it('usa los valores de ejemplo cuando no hay input', async () => {
    const config = whatsappTriggerNode.configSchema.parse({ sampleText: 'demo' });
    const result = await whatsappTriggerNode.execute(contextWith(config, undefined));
    expect('output' in result && result.output).toMatchObject({ text: 'demo', channel: 'whatsapp' });
  });
});

describe('trigger.webhook', () => {
  it('devuelve el payload recibido', async () => {
    const config = webhookTriggerNode.configSchema.parse({});
    expect(await webhookTriggerNode.execute(contextWith(config, { pedido: 7 }))).toEqual({
      output: { pedido: 7 },
    });
  });
});

import { parseWhatsAppWebhook } from './whatsapp/parse-webhook';
import { whatsappSendTextNode } from './nodes/whatsapp/send-text';

describe('parseWhatsAppWebhook', () => {
  it('parsea un mensaje de texto real de Meta con nombre de contacto', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                contacts: [{ wa_id: '5493410000000', profile: { name: 'Nico' } }],
                messages: [{ from: '5493410000000', id: 'wamid.X', type: 'text', text: { body: 'Hola, quiero un turno' } }],
              },
            },
          ],
        },
      ],
    };
    const messages = parseWhatsAppWebhook(payload);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      text: 'Hola, quiero un turno',
      phone: '5493410000000',
      name: 'Nico',
      channel: 'whatsapp',
      messageType: 'text',
    });
  });

  it('parsea respuestas de botón interactivo', () => {
    const payload = {
      entry: [{ changes: [{ value: { messages: [{ from: '549', type: 'interactive', interactive: { button_reply: { title: 'Sí' } } }] } }] }],
    };
    const [msg] = parseWhatsAppWebhook(payload);
    expect(msg?.text).toBe('Sí');
    expect(msg?.messageType).toBe('button');
  });

  it('devuelve vacío ante payloads no-WhatsApp o mal formados', () => {
    expect(parseWhatsAppWebhook(null)).toEqual([]);
    expect(parseWhatsAppWebhook({})).toEqual([]);
    expect(parseWhatsAppWebhook({ entry: [{}] })).toEqual([]);
  });
});

describe('whatsapp.send-text', () => {
  it('simula el envío sin servicio de WhatsApp real', async () => {
    const config = whatsappSendTextNode.configSchema.parse({ to: '549', text: 'Hola' });
    const services = {
      whatsapp: {
        async sendText(input) {
          return { to: input.to, text: input.text, sent: false, simulated: true };
        },
      },
    };
    const result = await whatsappSendTextNode.execute({
      config,
      input: {},
      nodeId: 'n',
      executionId: 'e',
      logger: silentLogger,
      signal: new AbortController().signal,
      services,
    });
    expect(result).toEqual({ output: { to: '549', text: 'Hola', sent: false, simulated: true } });
  });

  it('falla claro si no hay servicio de WhatsApp (simulador puro)', async () => {
    const config = whatsappSendTextNode.configSchema.parse({ to: '549', text: 'Hola' });
    await expect(
      whatsappSendTextNode.execute(contextWith(config, {})),
    ).rejects.toThrow('solo se ejecuta en el worker');
  });
});
