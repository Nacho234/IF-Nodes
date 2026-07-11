import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  credentialId: z.string().optional().default(''),
  /** Número destino (E.164 sin +). Por defecto, el del disparador. */
  to: z.string().min(1).max(40).default('{{trigger.phone}}'),
  text: z.string().min(1, 'El texto es obligatorio').max(4096),
});

type Config = z.infer<typeof configSchema>;

export const whatsappSendTextNode = defineNode<
  Config,
  unknown,
  { to: string; text: string; sent: boolean; simulated: boolean }
>({
  type: 'whatsapp.send-text',
  version: 1,
  category: 'whatsapp',
  displayName: 'Enviar mensaje de WhatsApp',
  description: 'Envía un texto por la API de WhatsApp Cloud (o lo simula sin credencial).',
  icon: 'send',
  configSchema,
  defaultConfig: { credentialId: '', to: '{{trigger.phone}}', text: 'Hola {{trigger.name}}, ¿en qué te ayudo?' },
  uiHints: [
    {
      field: 'credentialId',
      label: 'Credencial de WhatsApp',
      widget: 'credential',
      credentialTypes: ['whatsapp-cloud'],
      helpText: 'Sin credencial, el envío se simula (útil para el simulador).',
    },
    { field: 'to', label: 'Destino', widget: 'text', supportsExpressions: true, placeholder: '{{trigger.phone}}' },
    { field: 'text', label: 'Mensaje', widget: 'textarea', supportsExpressions: true },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'whatsapp-cloud', required: false }],
  outputVariables: [{ path: 'output.sent', description: 'true si se envió por la API real' }],
  exportable: true,
  documentation:
    'En el runtime exportado envía de verdad por WhatsApp Cloud. En el simulador (sin credencial) devuelve el texto marcado como simulado para mostrarlo en el chat.',
  async execute({ config, services }) {
    if (!services.whatsapp) {
      throw new NodeExecutionError(
        'WHATSAPP_SERVICE_UNAVAILABLE',
        'El nodo de WhatsApp solo se ejecuta en el worker/runtime.',
      );
    }
    const result = await services.whatsapp.sendText({
      credentialId: config.credentialId || undefined,
      to: config.to,
      text: config.text,
    });
    return { output: { to: result.to, text: result.text, sent: result.sent, simulated: result.simulated } };
  },
});
