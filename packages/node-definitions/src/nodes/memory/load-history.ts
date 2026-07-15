import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  channel: z.string().min(1).max(40).default('whatsapp'),
  /** Identificador del contacto (expresión). Por defecto el teléfono del disparador. */
  contact: z.string().min(1).max(200).default('{{trigger.phone}}'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

type Config = z.infer<typeof configSchema>;

/**
 * Carga el historial de conversación con el contacto. Deja `transcript` listo
 * para inyectar en el prompt de un nodo de IA ({{nodes.<id>.output.transcript}}).
 * Es la base para que el agente "recuerde" entre mensajes. Sin servicio de
 * memoria (p.ej. en tests) devuelve historial vacío sin romper el flujo.
 */
export const memoryLoadHistoryNode = defineNode<Config, unknown, unknown>({
  type: 'memory.load-history',
  version: 1,
  category: 'memory',
  displayName: 'Cargar historial',
  description: 'Trae los últimos mensajes con el contacto para que el agente recuerde la charla.',
  icon: 'history',
  configSchema,
  defaultConfig: { channel: 'whatsapp', contact: '{{trigger.phone}}', limit: 10 },
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
    {
      field: 'contact',
      label: 'Contacto',
      widget: 'text',
      supportsExpressions: true,
      helpText: 'Quién es el contacto en ese canal. Por defecto el teléfono del disparador.',
    },
    { field: 'limit', label: 'Cuántos turnos traer', widget: 'number' },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'transcript', description: 'Historial formateado para el prompt' },
    { path: 'turns', description: 'Historial como lista de turnos {role, text}' },
    { path: 'conversationId', description: 'Id de la conversación' },
    { path: 'status', description: 'Estado: open | handoff | closed' },
  ],
  exportable: true,
  documentation:
    'Poné este nodo antes del nodo de IA y usá {{nodes.<id>.output.transcript}} en el prompt o el system para que el agente tenga contexto de la conversación.',
  async execute({ config, services }) {
    if (!services.memory) {
      return { output: { conversationId: '', turns: [], transcript: '', status: 'open' } };
    }
    const result = await services.memory.loadHistory({
      channel: config.channel,
      contact: String(config.contact),
      limit: config.limit,
    });
    return {
      output: {
        conversationId: result.conversationId,
        turns: result.turns,
        transcript: result.transcript,
        status: result.status,
      },
    };
  },
});
