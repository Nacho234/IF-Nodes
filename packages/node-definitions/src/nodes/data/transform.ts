import { z } from 'zod';
import { defineNode } from '../../contract';

const assignmentSchema = z.object({
  key: z
    .string()
    .min(1, 'La clave es obligatoria')
    .max(100)
    .regex(/^[A-Za-z_][A-Za-z0-9_.]*$/, 'Clave inválida: usar letras, números, "_" y "."'),
  /** Valor literal o expresión {{ ... }} (el motor resuelve expresiones antes de ejecutar) */
  value: z.string().max(10_000),
});

const configSchema = z.object({
  assignments: z.array(assignmentSchema).min(1, 'Agregá al menos una asignación').max(50),
  /** Si es true, la salida combina la entrada con las asignaciones */
  keepInput: z.boolean().default(true),
});

type Config = z.infer<typeof configSchema>;

/** Asigna respetando paths con punto: "contact.name" → { contact: { name } } */
function setByPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.');
  let cursor = target;
  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i] as string;
    const existing = cursor[segment];
    if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] as string] = value;
}

export const transformNode = defineNode<Config, unknown, Record<string, unknown>>({
  type: 'data.transform',
  version: 1,
  category: 'data',
  displayName: 'Transformar datos',
  description: 'Construye o modifica un objeto asignando claves y valores.',
  icon: 'shuffle',
  configSchema,
  defaultConfig: {
    assignments: [{ key: 'greeting', value: 'Hola {{trigger.text}}' }],
    keepInput: true,
  },
  uiHints: [
    {
      field: 'assignments',
      label: 'Asignaciones',
      helpText: 'Cada fila define clave → valor. Los valores admiten expresiones {{ ... }}.',
      widget: 'keyvalue',
      supportsExpressions: true,
    },
    {
      field: 'keepInput',
      label: 'Conservar datos de entrada',
      helpText: 'Combina la entrada del nodo con las asignaciones en la salida.',
      widget: 'switch',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [{ path: 'output', description: 'Objeto resultante de las asignaciones' }],
  exportable: true,
  async execute({ config, input }) {
    const base: Record<string, unknown> =
      config.keepInput && typeof input === 'object' && input !== null && !Array.isArray(input)
        ? { ...(input as Record<string, unknown>) }
        : {};
    for (const { key, value } of config.assignments) {
      setByPath(base, key, value);
    }
    return { output: base };
  },
});
