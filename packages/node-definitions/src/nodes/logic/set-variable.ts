import { z } from 'zod';
import { defineNode } from '../../contract';

const assignmentSchema = z.object({
  key: z
    .string()
    .min(1, 'La clave es obligatoria')
    .max(100)
    .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Clave inválida: letras, números y "_"'),
  value: z.string().max(10_000),
});

const configSchema = z.object({
  assignments: z.array(assignmentSchema).min(1, 'Agregá al menos una variable').max(50),
});

type Config = z.infer<typeof configSchema>;

export const setVariableNode = defineNode<Config, unknown, unknown>({
  type: 'logic.set-variable',
  version: 1,
  category: 'logic',
  displayName: 'Establecer variable',
  description: 'Guarda valores en {{variables.*}} para el resto del flujo.',
  icon: 'braces',
  configSchema,
  defaultConfig: { assignments: [{ key: 'companyName', value: 'Mi empresa' }] },
  uiHints: [
    {
      field: 'assignments',
      label: 'Variables',
      widget: 'keyvalue',
      supportsExpressions: true,
      helpText: 'Quedan disponibles como {{variables.clave}} en los nodos siguientes.',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [{ path: 'variables', description: 'Variables definidas en este nodo' }],
  exportable: true,
  async execute({ config, input }) {
    const variables: Record<string, unknown> = {};
    for (const { key, value } of config.assignments) variables[key] = value;
    // La entrada pasa intacta; las variables van al contexto
    return { output: input, variables };
  },
});
