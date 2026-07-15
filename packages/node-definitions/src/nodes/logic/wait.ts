import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  /** Segundos a esperar. Capado por el límite de duración del motor (~60s). */
  seconds: z.coerce.number().int().min(1).max(60).default(3),
});

type Config = z.infer<typeof configSchema>;

/**
 * Pausa la rama una cantidad corta de segundos (respeta la cancelación). Sirve
 * para dar ritmo a una conversación (p.ej. esperar antes de un segundo mensaje).
 * Para esperas largas (horas/días, seguimientos), usá el disparador Programado
 * (cron): la suspensión/reanudación de ejecuciones largas es una fase futura.
 */
export const waitNode = defineNode<Config, unknown, unknown>({
  type: 'logic.wait',
  version: 1,
  category: 'logic',
  displayName: 'Esperar',
  description: 'Pausa la rama unos segundos antes de continuar (esperas cortas).',
  icon: 'timer',
  configSchema,
  defaultConfig: { seconds: 3 },
  uiHints: [
    {
      field: 'seconds',
      label: 'Segundos',
      widget: 'number',
      helpText: 'Hasta 60s. Para esperas largas usá un disparador Programado (cron).',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  exportable: true,
  async execute({ config, input, signal }) {
    if (signal.aborted) {
      throw new NodeExecutionError('WAIT_CANCELLED', 'La espera se canceló.');
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, config.seconds * 1000);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new NodeExecutionError('WAIT_CANCELLED', 'La espera se canceló.'));
        },
        { once: true },
      );
    });
    return { output: input };
  },
});
