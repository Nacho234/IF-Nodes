import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  /** Payload de ejemplo (JSON) con el que arranca una ejecución manual */
  samplePayloadJson: z
    .string()
    .max(20_000)
    .default('{}')
    .refine(
      (value) => {
        try {
          JSON.parse(value);
          return true;
        } catch {
          return false;
        }
      },
      { message: 'Debe ser JSON válido' },
    ),
});

type Config = z.infer<typeof configSchema>;

export const manualTriggerNode = defineNode<Config, unknown, Record<string, unknown>>({
  type: 'trigger.manual',
  version: 1,
  category: 'trigger',
  displayName: 'Inicio manual',
  description: 'Inicia el flujo a demanda con un payload de prueba.',
  icon: 'play',
  configSchema,
  defaultConfig: { samplePayloadJson: '{\n  "text": "Hola"\n}' },
  uiHints: [
    {
      field: 'samplePayloadJson',
      label: 'Payload de ejemplo (JSON)',
      helpText: 'Datos con los que arranca la ejecución manual. Disponible como {{trigger.*}}.',
      widget: 'code',
    },
  ],
  inputs: [],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [{ path: 'trigger', description: 'Payload inicial de la ejecución' }],
  exportable: true,
  documentation:
    'Punto de entrada para ejecuciones a demanda desde el builder. En el runtime exportado equivale a una invocación directa del flujo.',
  async execute({ config, input }) {
    // Un payload real no vacío (p.ej. del simulador) tiene prioridad sobre el de ejemplo.
    if (
      input !== undefined &&
      input !== null &&
      typeof input === 'object' &&
      Object.keys(input).length > 0
    ) {
      return { output: input as Record<string, unknown> };
    }
    try {
      return { output: JSON.parse(config.samplePayloadJson) as Record<string, unknown> };
    } catch {
      throw new NodeExecutionError('TRIGGER_PAYLOAD_INVALID', 'El payload de ejemplo no es JSON válido.');
    }
  },
});
