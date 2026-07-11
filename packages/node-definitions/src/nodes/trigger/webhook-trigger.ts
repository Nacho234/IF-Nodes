import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  /** Nota descriptiva de qué recibe este webhook (documentación del flujo) */
  description: z.string().max(500).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

export const webhookTriggerNode = defineNode<Config, unknown, Record<string, unknown>>({
  type: 'trigger.webhook',
  version: 1,
  category: 'trigger',
  displayName: 'Webhook recibido',
  description: 'Inicia el flujo cuando llega un POST a la URL del webhook.',
  icon: 'webhook',
  configSchema,
  defaultConfig: { description: '' },
  uiHints: [
    {
      field: 'description',
      label: 'Descripción',
      widget: 'textarea',
      placeholder: 'Qué sistema envía datos a este webhook…',
    },
  ],
  inputs: [],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [{ path: 'trigger', description: 'Cuerpo JSON recibido en el webhook' }],
  exportable: true,
  documentation:
    'La URL del webhook (con su token) se muestra en el panel al seleccionar este nodo. En el builder responde 202 con el id de ejecución; la respuesta síncrona llega con el nodo "Responder webhook" (Fase 7).',
  async execute({ input }) {
    return { output: (input as Record<string, unknown>) ?? {} };
  },
});
