import { z } from 'zod';
import { defineNode } from '../../contract';

export const CONDITION_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'notContains',
  'exists',
  'notExists',
  'greaterThan',
  'lessThan',
] as const;

const configSchema = z.object({
  /** Valor a evaluar; admite expresiones (queda resuelto antes de ejecutar) */
  left: z.string().max(2000),
  operator: z.enum(CONDITION_OPERATORS),
  /** Valor de comparación (no aplica para exists/notExists) */
  right: z.string().max(2000).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

function asComparable(value: string): string | number {
  const n = Number(value);
  return value.trim() !== '' && !Number.isNaN(n) ? n : value;
}

function evaluate(config: Config): boolean {
  const { left, operator, right } = config;
  switch (operator) {
    case 'exists':
      return left.trim() !== '' && left !== 'undefined' && left !== 'null';
    case 'notExists':
      return left.trim() === '' || left === 'undefined' || left === 'null';
    case 'equals':
      return String(asComparable(left)) === String(asComparable(right));
    case 'notEquals':
      return String(asComparable(left)) !== String(asComparable(right));
    case 'contains':
      return left.toLowerCase().includes(right.toLowerCase());
    case 'notContains':
      return !left.toLowerCase().includes(right.toLowerCase());
    case 'greaterThan':
      return Number(left) > Number(right);
    case 'lessThan':
      return Number(left) < Number(right);
  }
}

export const conditionNode = defineNode<Config, unknown, never>({
  type: 'logic.condition',
  version: 1,
  category: 'logic',
  displayName: 'Condición Si/No',
  description: 'Evalúa una condición y sigue por la rama Sí o No.',
  icon: 'git-fork',
  configSchema,
  defaultConfig: { left: '{{trigger.text}}', operator: 'contains', right: 'turno' },
  uiHints: [
    {
      field: 'left',
      label: 'Valor a evaluar',
      widget: 'text',
      supportsExpressions: true,
      placeholder: '{{trigger.text}}',
    },
    {
      field: 'operator',
      label: 'Operador',
      widget: 'select',
      options: [
        { value: 'contains', label: 'Contiene' },
        { value: 'notContains', label: 'No contiene' },
        { value: 'equals', label: 'Igual a' },
        { value: 'notEquals', label: 'Distinto de' },
        { value: 'exists', label: 'Existe (no vacío)' },
        { value: 'notExists', label: 'No existe (vacío)' },
        { value: 'greaterThan', label: 'Mayor que' },
        { value: 'lessThan', label: 'Menor que' },
      ],
    },
    {
      field: 'right',
      label: 'Comparar con',
      widget: 'text',
      supportsExpressions: true,
      helpText: 'No aplica para Existe / No existe.',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [
    { id: 'true', label: 'Sí' },
    { id: 'false', label: 'No' },
  ],
  outputVariables: [],
  exportable: true,
  documentation: 'La comparación de texto no distingue mayúsculas. Si ambos lados son numéricos, compara como números.',
  async execute({ config, input }) {
    const port = evaluate(config) ? 'true' : 'false';
    return { outputsByPort: { [port]: input } };
  },
});
