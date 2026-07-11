import { z } from 'zod';
import { defineNode } from '../../contract';

const configSchema = z.object({
  /** Valor a comparar; admite expresiones */
  value: z.string().max(2000),
  case1: z.string().max(500).optional().default(''),
  case2: z.string().max(500).optional().default(''),
  case3: z.string().max(500).optional().default(''),
});

type Config = z.infer<typeof configSchema>;

export const switchNode = defineNode<Config, unknown, never>({
  type: 'logic.switch',
  version: 1,
  category: 'logic',
  displayName: 'Switch',
  description: 'Enruta según el valor coincida con un caso (o sigue por Default).',
  icon: 'git-fork',
  configSchema,
  defaultConfig: { value: '{{trigger.intent}}', case1: '', case2: '', case3: '' },
  uiHints: [
    { field: 'value', label: 'Valor a comparar', widget: 'text', supportsExpressions: true },
    { field: 'case1', label: 'Caso 1', widget: 'text', helpText: 'Sale por el puerto «1» si coincide.' },
    { field: 'case2', label: 'Caso 2', widget: 'text' },
    { field: 'case3', label: 'Caso 3', widget: 'text' },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [
    { id: 'case1', label: '1' },
    { id: 'case2', label: '2' },
    { id: 'case3', label: '3' },
    { id: 'default', label: 'Def' },
  ],
  outputVariables: [],
  exportable: true,
  documentation:
    'Comparación exacta de texto (sin distinguir mayúsculas). Los casos vacíos se ignoran; si nada coincide sale por Default.',
  async execute({ config, input }) {
    const value = config.value.trim().toLowerCase();
    const cases: [string, string][] = [
      ['case1', config.case1],
      ['case2', config.case2],
      ['case3', config.case3],
    ];
    for (const [port, match] of cases) {
      if (match.trim() !== '' && match.trim().toLowerCase() === value) {
        return { outputsByPort: { [port]: input } };
      }
    }
    return { outputsByPort: { default: input } };
  },
});
