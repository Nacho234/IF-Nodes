import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  samplePhone: z.string().max(40).default('5493410000000'),
  sampleName: z.string().max(120).default('Contacto de prueba'),
  sampleEmail: z.string().max(320).default(''),
});

type Config = z.infer<typeof configSchema>;

/**
 * Disparador de campaña: el flujo corre UNA VEZ POR CONTACTO. Lo lanza el motor
 * de campañas (fan-out): consulta los contactos por filtro y encola una
 * ejecución por cada uno, con el contacto como disparo. Usá {{trigger.phone}},
 * {{trigger.name}}, {{trigger.email}}, {{trigger.status}} para personalizar.
 */
export const campaignTriggerNode = defineNode<Config, unknown, Record<string, unknown>>({
  type: 'trigger.campaign-contact',
  version: 1,
  category: 'trigger',
  displayName: 'Campaña (por contacto)',
  description: 'Corre el flujo una vez por cada contacto de la campaña (outreach masivo).',
  icon: 'send',
  configSchema,
  defaultConfig: { samplePhone: '5493410000000', sampleName: 'Contacto de prueba', sampleEmail: '' },
  uiHints: [
    { field: 'samplePhone', label: 'Teléfono de ejemplo', widget: 'text' },
    { field: 'sampleName', label: 'Nombre de ejemplo', widget: 'text' },
    { field: 'sampleEmail', label: 'Email de ejemplo', widget: 'text' },
  ],
  inputs: [],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'trigger.phone', description: 'Teléfono del contacto' },
    { path: 'trigger.name', description: 'Nombre del contacto' },
    { path: 'trigger.email', description: 'Email del contacto' },
    { path: 'trigger.status', description: 'Estado/etapa del contacto' },
    { path: 'trigger.contactId', description: 'Id del contacto' },
  ],
  exportable: true,
  documentation:
    'Se lanza desde la sección Campañas del proyecto (elegís el filtro de contactos). Cada contacto es una ejecución independiente, con ritmo controlado. Para WhatsApp saliente masivo, Meta exige plantillas HSM aprobadas.',
  async execute({ config, input }) {
    const raw = (input ?? {}) as Record<string, unknown>;
    const hasContact = typeof raw.phone === 'string' || typeof raw.email === 'string' || typeof raw.contactId === 'string';
    if (hasContact) {
      return { output: raw };
    }
    return {
      output: {
        phone: config.samplePhone,
        name: config.sampleName,
        email: config.sampleEmail,
        status: 'new',
        tags: [],
      },
    };
  },
});
