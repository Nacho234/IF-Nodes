import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  channel: z.string().min(1).max(40).default('whatsapp'),
  contact: z.string().min(1).max(200).default('{{trigger.phone}}'),
  status: z.enum(['handoff', 'closed', 'open']).default('handoff'),
  /** Nota opcional que queda en el historial (por qué se escaló). */
  note: z.string().max(2000).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

/**
 * Escala la conversación a un operador humano: marca el estado (handoff) para
 * que el bot deje de responder ese hilo. Combinalo con "Cargar historial"
 * (que devuelve `status`) para, al inicio del flujo, no auto-responder si ya
 * está en handoff, y con "Enviar email/WhatsApp" para avisarle al operador.
 */
export const escalateNode = defineNode<Config, unknown, unknown>({
  type: 'communication.escalate',
  version: 1,
  category: 'communication',
  displayName: 'Escalar a humano',
  description: 'Marca la conversación como tomada por un humano (handoff) para que el bot no responda.',
  icon: 'user-round-cog',
  configSchema,
  defaultConfig: { channel: 'whatsapp', contact: '{{trigger.phone}}', status: 'handoff', note: '' },
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
      field: 'status',
      label: 'Nuevo estado',
      widget: 'select',
      options: [
        { value: 'handoff', label: 'Handoff (lo toma un humano)' },
        { value: 'closed', label: 'Cerrada' },
        { value: 'open', label: 'Abierta (el bot vuelve a responder)' },
      ],
    },
    { field: 'note', label: 'Nota para el historial', widget: 'textarea', supportsExpressions: true },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [{ path: 'output.status', description: 'Nuevo estado de la conversación' }],
  exportable: true,
  async execute({ config, input, services }) {
    if (!services.memory) {
      throw new NodeExecutionError('MEMORY_SERVICE_UNAVAILABLE', 'Escalar a humano requiere memoria (worker/runtime).');
    }
    if (config.note) {
      await services.memory.saveTurn({ channel: config.channel, contact: config.contact, role: 'system', text: config.note });
    }
    const { conversationId } = await services.memory.setStatus({
      channel: config.channel,
      contact: config.contact,
      status: config.status,
    });
    const base = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return { output: { ...base, status: config.status, conversationId } };
  },
});
