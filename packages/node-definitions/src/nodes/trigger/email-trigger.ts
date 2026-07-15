import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  sampleSubject: z.string().max(400).default('Consulta sobre el festival'),
  sampleText: z.string().max(5000).default('Hola, quería saber cómo participar.'),
  sampleFrom: z.string().max(200).default('contacto@agencia.com'),
  sampleName: z.string().max(120).default('Contacto de prueba'),
});

type Config = z.infer<typeof configSchema>;

export interface EmailIncomingMessage extends Record<string, unknown> {
  /** Cuerpo del mail ya limpio: sin la cita del mensaje anterior ni la firma. */
  text: string;
  subject: string;
  /** Dirección del remitente en minúsculas. Es la clave del hilo de conversación. */
  from: string;
  name: string;
  /** Message-ID original, para poder responder dentro del mismo hilo. */
  messageId: string;
  /** Message-ID al que responde, si es una respuesta. */
  inReplyTo: string;
  channel: 'email';
  receivedAt: string;
}

/**
 * Mail entrante. Es el espejo del disparador de WhatsApp: los nodos que siguen
 * no distinguen el canal, solo cambia la clave del hilo (dirección en vez de teléfono).
 *
 * El transporte (Gmail, IMAP, o un proveedor con webhook de entrada) es intercambiable:
 * quien sea que reciba el mail lo normaliza con `parseInboundEmail` y lo entrega acá.
 */
export const emailTriggerNode = defineNode<Config, unknown, EmailIncomingMessage>({
  type: 'trigger.email-message',
  version: 1,
  category: 'communication',
  displayName: 'Mail recibido',
  description: 'Inicia el flujo cuando entra un mail a la casilla.',
  icon: 'mail',
  configSchema,
  defaultConfig: {
    sampleSubject: 'Consulta sobre el festival',
    sampleText: 'Hola, quería saber cómo participar.',
    sampleFrom: 'contacto@agencia.com',
    sampleName: 'Contacto de prueba',
  },
  uiHints: [
    { field: 'sampleFrom', label: 'Remitente de ejemplo', widget: 'text' },
    { field: 'sampleName', label: 'Nombre de ejemplo', widget: 'text' },
    { field: 'sampleSubject', label: 'Asunto de ejemplo', widget: 'text' },
    { field: 'sampleText', label: 'Cuerpo de ejemplo', widget: 'textarea' },
  ],
  inputs: [],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'trigger.text', description: 'Cuerpo del mail, sin la cita anterior ni la firma' },
    { path: 'trigger.subject', description: 'Asunto' },
    { path: 'trigger.from', description: 'Dirección del remitente (clave del hilo)' },
    { path: 'trigger.name', description: 'Nombre del remitente' },
    { path: 'trigger.messageId', description: 'Message-ID, para responder en el mismo hilo' },
  ],
  exportable: true,
  documentation:
    'El runtime exportado expone POST /webhooks/email. El transporte (Gmail, IMAP o un proveedor) postea ahí el mail crudo y el runtime lo normaliza. Usá el Simulador para probar sin transporte.',
  async execute({ config, input }) {
    const raw = (input ?? {}) as Partial<EmailIncomingMessage>;
    const real = typeof raw.text === 'string' && raw.text.length > 0;
    return {
      output: {
        text: real ? (raw.text as string) : config.sampleText,
        subject: (real ? raw.subject : undefined) ?? config.sampleSubject,
        from: ((real ? raw.from : undefined) ?? config.sampleFrom).toLowerCase(),
        name: (real ? raw.name : undefined) ?? config.sampleName,
        messageId: raw.messageId ?? '',
        inReplyTo: raw.inReplyTo ?? '',
        channel: 'email',
        receivedAt: new Date().toISOString(),
      },
    };
  },
});
