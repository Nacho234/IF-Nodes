import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  sampleText: z.string().max(2000).default('Hola, quiero un turno'),
  samplePhone: z.string().max(40).default('5493410000000'),
  sampleName: z.string().max(120).default('Cliente de prueba'),
});

type Config = z.infer<typeof configSchema>;

export interface WhatsAppIncomingMessage extends Record<string, unknown> {
  text: string;
  phone: string;
  name: string;
  messageType: 'text' | 'image' | 'audio' | 'location' | 'button';
  channel: 'whatsapp';
  receivedAt: string;
}

/**
 * Qué poner como texto cuando el mensaje no trae ninguno. El bot no puede escuchar
 * ni ver: al menos tiene que saber QUÉ le mandaron para contestar con sentido.
 */
const MEDIA_PLACEHOLDER: Record<string, string> = {
  audio: '[el contacto mandó una nota de voz, sin texto]',
  image: '[el contacto mandó una imagen, sin texto]',
  location: '[el contacto mandó una ubicación]',
  button: '[el contacto tocó un botón, sin texto]',
};

/**
 * Mensaje de WhatsApp entrante. En el builder lo alimenta el Simulador
 * (mismo formato interno que usará el proveedor real de WhatsApp Cloud
 * en Fase 7 — los nodos siguientes no distinguen simulado de real).
 */
export const whatsappTriggerNode = defineNode<Config, unknown, WhatsAppIncomingMessage>({
  type: 'trigger.whatsapp-message',
  version: 1,
  category: 'whatsapp',
  displayName: 'Mensaje de WhatsApp',
  description: 'Inicia el flujo al recibir un mensaje (simulado o real).',
  icon: 'message-circle',
  configSchema,
  defaultConfig: {
    sampleText: 'Hola, quiero un turno',
    samplePhone: '5493410000000',
    sampleName: 'Cliente de prueba',
  },
  uiHints: [
    { field: 'sampleText', label: 'Mensaje de ejemplo', widget: 'text' },
    { field: 'samplePhone', label: 'Teléfono de ejemplo', widget: 'text' },
    { field: 'sampleName', label: 'Nombre de ejemplo', widget: 'text' },
  ],
  inputs: [],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'trigger.text', description: 'Texto del mensaje' },
    { path: 'trigger.phone', description: 'Teléfono del contacto' },
    { path: 'trigger.name', description: 'Nombre del contacto' },
  ],
  exportable: true,
  documentation:
    'Usá el Simulador del constructor para conversar con el bot. Los valores de ejemplo se usan cuando se ejecuta sin simulador (botón Ejecutar).',
  async execute({ config, input }) {
    const raw = (input ?? {}) as Partial<WhatsAppIncomingMessage>;
    // "Es real" se decide por el TELÉFONO, no por el texto: una nota de voz o una
    // imagen sin epígrafe llegan sin texto, y antes eso hacía que se descartara el
    // mensaje entero — el bot le respondía al teléfono de ejemplo, no a la agencia.
    const hasRealInput = typeof raw.phone === 'string' && raw.phone.length > 0;
    const messageType = raw.messageType ?? 'text';
    const text = hasRealInput ? (raw.text ?? '') : config.sampleText;
    return {
      output: {
        // Sin texto no se puede responder a ciegas: se describe qué mandó, para que
        // el flujo pueda contestar algo con sentido (o derivarlo a una persona).
        text: text || (hasRealInput ? MEDIA_PLACEHOLDER[messageType] ?? '[el contacto mandó un adjunto sin texto]' : text),
        phone: hasRealInput ? (raw.phone as string) : config.samplePhone,
        name: (hasRealInput ? raw.name : undefined) ?? config.sampleName,
        messageType,
        channel: 'whatsapp',
        receivedAt: new Date().toISOString(),
      },
    };
  },
});
