import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  /** Texto de respuesta; admite expresiones {{ ... }} */
  message: z.string().min(1, 'El mensaje es obligatorio').max(10_000),
});

type Config = z.infer<typeof configSchema>;

export const respondNode = defineNode<Config, unknown, { message: string }>({
  type: 'communication.respond',
  version: 1,
  category: 'communication',
  displayName: 'Respuesta',
  description: 'Devuelve la respuesta final del flujo.',
  icon: 'message-square-reply',
  configSchema,
  defaultConfig: { message: '{{nodes.transform.output.greeting}}' },
  uiHints: [
    {
      field: 'message',
      label: 'Mensaje',
      helpText: 'Respuesta que entrega el flujo. Admite expresiones {{ ... }}.',
      widget: 'textarea',
      supportsExpressions: true,
      placeholder: 'Hola, ¿en qué puedo ayudarte?',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [],
  outputVariables: [{ path: 'output.message', description: 'Mensaje final devuelto' }],
  exportable: true,
  documentation:
    'Nodo terminal: marca la respuesta del flujo. En el runtime exportado se materializa como respuesta del webhook o mensaje saliente según el trigger.',
  async execute({ config }) {
    return { output: { message: config.message } };
  },
});
