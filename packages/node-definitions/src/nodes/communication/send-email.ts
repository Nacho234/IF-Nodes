import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  credentialId: z.string().optional().default(''),
  to: z.string().min(1, 'El destinatario es obligatorio').max(320),
  subject: z.string().min(1, 'El asunto es obligatorio').max(500),
  body: z.string().max(50_000).default(''),
  /** Si el cuerpo es HTML (si no, se manda como texto plano). */
  html: z.coerce.boolean().default(false),
  /** Remitente opcional; si falta, se usa el usuario de la credencial SMTP. */
  from: z.string().max(320).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

/**
 * Envía un email por SMTP (según la credencial elegida). Sin credencial, queda
 * simulado (útil para probar el flujo). Canal para notificaciones, handoff al
 * operador y outreach por email.
 */
export const sendEmailNode = defineNode<Config, unknown, unknown>({
  type: 'communication.send-email',
  version: 1,
  category: 'communication',
  displayName: 'Enviar email',
  description: 'Manda un email por SMTP (real con credencial, simulado sin ella).',
  icon: 'mail',
  configSchema,
  defaultConfig: {
    credentialId: '',
    to: '{{trigger.email}}',
    subject: 'Aviso',
    body: 'Hola,\n\n',
    html: false,
    from: '',
  },
  uiHints: [
    {
      field: 'credentialId',
      label: 'Credencial SMTP',
      widget: 'credential',
      credentialTypes: ['smtp'],
      helpText: 'Sin credencial, el envío queda simulado.',
    },
    { field: 'to', label: 'Para', widget: 'text', supportsExpressions: true, placeholder: 'destino@dominio.com' },
    { field: 'from', label: 'Remitente (opcional)', widget: 'text', supportsExpressions: true },
    { field: 'subject', label: 'Asunto', widget: 'text', supportsExpressions: true },
    { field: 'body', label: 'Cuerpo', widget: 'textarea', supportsExpressions: true },
    { field: 'html', label: 'El cuerpo es HTML', widget: 'switch' },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'smtp', required: false }],
  outputVariables: [
    { path: 'output.sent', description: 'true si se envió por SMTP real' },
    { path: 'output.messageId', description: 'Id del mensaje enviado' },
  ],
  exportable: true,
  async execute({ config, services }) {
    if (!services.email) {
      throw new NodeExecutionError('EMAIL_SERVICE_UNAVAILABLE', 'El nodo de email solo se ejecuta en el worker/runtime.');
    }
    const result = await services.email.send({
      credentialId: config.credentialId || undefined,
      to: config.to,
      subject: config.subject,
      text: config.html ? '' : config.body,
      html: config.html ? config.body : undefined,
      from: config.from || undefined,
    });
    return { output: result };
  },
});
