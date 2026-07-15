import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  channel: z.string().min(1).max(40).default('whatsapp'),
  contact: z.string().min(1).max(200).default('{{trigger.phone}}'),
  role: z.enum(['user', 'assistant']).default('assistant'),
  text: z.string().max(10_000).default('{{trigger.text}}'),
});

type Config = z.infer<typeof configSchema>;

/**
 * Guarda un turno en la memoria de conversación. Típicamente se usan dos: uno
 * para el mensaje entrante del contacto (role "user", texto {{trigger.text}}) y
 * otro para la respuesta del bot (role "assistant"). La entrada pasa intacta
 * para no cortar el flujo. Sin servicio de memoria es un no-op.
 */
export const memorySaveTurnNode = defineNode<Config, unknown, unknown>({
  type: 'memory.save-turn',
  version: 1,
  category: 'memory',
  displayName: 'Guardar turno',
  description: 'Guarda un mensaje en la memoria del contacto (para recordarlo después).',
  icon: 'save',
  configSchema,
  defaultConfig: { channel: 'whatsapp', contact: '{{trigger.phone}}', role: 'assistant', text: '{{trigger.text}}' },
  uiHints: [
    {
      field: 'channel',
      label: 'Canal',
      widget: 'select',
      options: [
        { value: 'whatsapp', label: 'WhatsApp' },
        { value: 'email', label: 'Email' },
        { value: 'web', label: 'Chat web' },
      ],
    },
    { field: 'contact', label: 'Contacto', widget: 'text', supportsExpressions: true },
    {
      field: 'role',
      label: 'Quién habla',
      widget: 'select',
      options: [
        { value: 'user', label: 'El contacto (user)' },
        { value: 'assistant', label: 'El bot (assistant)' },
      ],
    },
    {
      field: 'text',
      label: 'Texto',
      widget: 'textarea',
      supportsExpressions: true,
      helpText: 'Qué guardar. Para el contacto: {{trigger.text}}. Para el bot: la salida del nodo de IA.',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [{ path: 'conversationId', description: 'Id de la conversación' }],
  exportable: true,
  async execute({ config, input, services }) {
    if (!services.memory) {
      return { output: input };
    }
    const { conversationId } = await services.memory.saveTurn({
      channel: config.channel,
      contact: String(config.contact),
      role: config.role,
      text: config.text,
    });
    // La entrada pasa intacta; sumamos el id de conversación por si se necesita
    const base = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return { output: { ...base, conversationId } };
  },
});
