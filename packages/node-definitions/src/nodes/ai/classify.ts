import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  credentialId: z.string().optional().default(''),
  model: z.string().max(100).optional().default(''),
  text: z.string().min(1, 'El texto a clasificar es obligatorio').max(10_000),
  /** Categorías separadas por coma */
  categories: z.string().min(1, 'Definí al menos dos categorías').max(2000),
});

type Config = z.infer<typeof configSchema>;

export const aiClassifyNode = defineNode<Config, unknown, { category: string; provider: string }>({
  type: 'ai.classify',
  version: 1,
  category: 'ai',
  displayName: 'Clasificar intención',
  description: 'Clasifica un texto en una de las categorías dadas.',
  icon: 'tags',
  configSchema,
  defaultConfig: {
    credentialId: '',
    model: '',
    text: '{{trigger.text}}',
    categories: 'turno, precio, reclamo, saludo, otro',
  },
  uiHints: [
    {
      field: 'credentialId',
      label: 'Credencial de IA',
      widget: 'credential',
      credentialTypes: ['anthropic', 'openai', 'gemini'],
      helpText: 'Sin credencial, usa el proveedor de desarrollo (heurística simple, sin costo).',
    },
    { field: 'model', label: 'Modelo', widget: 'text', placeholder: 'claude-sonnet-4-5 / gpt-4o…' },
    { field: 'text', label: 'Texto a clasificar', widget: 'textarea', supportsExpressions: true },
    {
      field: 'categories',
      label: 'Categorías',
      widget: 'text',
      helpText: 'Separadas por coma. La salida es una de estas (o la primera si no hay match).',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'anthropic', required: false }],
  outputVariables: [{ path: 'output.category', description: 'Categoría elegida' }],
  exportable: true,
  documentation:
    'Ideal antes de un Switch: clasificás la intención y ramificás. En desarrollo, el proveedor simulado usa coincidencia de palabras.',
  async execute({ config, services }) {
    if (!services.ai) {
      throw new NodeExecutionError('AI_SERVICE_UNAVAILABLE', 'El nodo de IA solo se ejecuta en el worker/runtime.');
    }
    const categories = config.categories
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (categories.length < 2) {
      throw new NodeExecutionError('AI_CLASSIFY_CATEGORIES', 'Definí al menos dos categorías.');
    }
    const result = await services.ai.classify({
      credentialId: config.credentialId || undefined,
      model: config.model || undefined,
      text: config.text,
      categories,
    });
    return { output: { category: result.category, provider: result.provider } };
  },
});
