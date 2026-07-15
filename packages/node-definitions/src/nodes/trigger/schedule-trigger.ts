import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  /** Expresión cron estándar (min hora díaMes mes díaSemana). */
  cron: z.string().min(1, 'Definí una expresión cron').max(120).default('0 9 * * *'),
  /** Zona horaria IANA, p.ej. "America/Argentina/Buenos_Aires". */
  timezone: z.string().max(60).default('America/Argentina/Buenos_Aires'),
});

type Config = z.infer<typeof configSchema>;

/**
 * Disparador programado (cron): corre el flujo en la cadencia indicada. El
 * scheduler del worker mantiene el job de BullMQ. Es la base de los flujos de
 * seguimiento automático (p.ej. "todos los días revisar quién no respondió").
 * Al ejecutar manualmente (botón Ejecutar) usa el momento actual como disparo.
 */
export const scheduleTriggerNode = defineNode<Config, unknown, { firedAt: string; cron: string }>({
  type: 'trigger.schedule',
  version: 1,
  category: 'trigger',
  displayName: 'Programado (cron)',
  description: 'Dispara el flujo en un horario/cadencia (p.ej. todos los días a las 9).',
  icon: 'clock',
  configSchema,
  defaultConfig: { cron: '0 9 * * *', timezone: 'America/Argentina/Buenos_Aires' },
  uiHints: [
    {
      field: 'cron',
      label: 'Cron',
      widget: 'text',
      placeholder: '0 9 * * *',
      helpText: 'Ejemplos: "0 9 * * *" (9am diario) · "*/15 * * * *" (cada 15 min) · "0 9 * * 1" (lunes 9am).',
    },
    { field: 'timezone', label: 'Zona horaria', widget: 'text', placeholder: 'America/Argentina/Buenos_Aires' },
  ],
  inputs: [],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'trigger.firedAt', description: 'Momento en que se disparó' },
    { path: 'trigger.cron', description: 'La expresión cron configurada' },
  ],
  exportable: true,
  documentation:
    'El scheduler del worker registra un job por cada flujo con este nodo. Para seguimientos "a las 48h" armá un flujo diario que revise el estado de cada contacto.',
  async execute({ config, input }) {
    const raw = (input ?? {}) as { firedAt?: string };
    return {
      output: {
        firedAt: raw.firedAt ?? new Date().toISOString(),
        cron: config.cron,
      },
    };
  },
});
