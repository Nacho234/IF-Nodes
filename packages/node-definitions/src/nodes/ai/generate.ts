import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  credentialId: z.string().optional().default(''),
  model: z.string().max(100).optional().default(''),
  system: z.string().max(10_000).optional().default(''),
  prompt: z.string().min(1, 'El prompt es obligatorio').max(20_000),
  maxTokens: z.coerce.number().int().min(1).max(8000).optional().default(1024),
});

type Config = z.infer<typeof configSchema>;

export const aiGenerateNode = defineNode<Config, unknown, { text: string; model: string; provider: string }>({
  type: 'ai.generate',
  version: 1,
  category: 'ai',
  displayName: 'Generar respuesta',
  description: 'Genera texto con un modelo de IA (según la credencial elegida).',
  icon: 'sparkles',
  configSchema,
  defaultConfig: {
    credentialId: '',
    model: '',
    system: 'Sos el asistente de atención de la empresa. Respondé claro y breve.',
    prompt: 'El cliente escribió: {{trigger.text}}\nRespondé de forma amable.',
    maxTokens: 1024,
  },
  uiHints: [
    {
      field: 'credentialId',
      label: 'Credencial de IA',
      widget: 'credential',
      credentialTypes: ['anthropic', 'openai', 'gemini'],
      helpText: 'Sin credencial, usa el proveedor de desarrollo (respuestas simuladas, sin costo).',
    },
    { field: 'model', label: 'Modelo', widget: 'text', placeholder: 'claude-sonnet-4-5 / gpt-4o…' },
    { field: 'system', label: 'Instrucciones (system)', widget: 'textarea', supportsExpressions: true },
    { field: 'prompt', label: 'Prompt', widget: 'textarea', supportsExpressions: true },
    { field: 'maxTokens', label: 'Máx. tokens', widget: 'number' },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'anthropic', required: false }],
  outputVariables: [{ path: 'output.text', description: 'Texto generado' }],
  exportable: true,
  documentation:
    'Detrás de una interfaz de proveedores: se pueden usar OpenAI, Anthropic, Gemini u otros. En desarrollo, sin credencial, responde un proveedor simulado claramente identificado.',
  async execute({ config, services }) {
    if (!services.ai) {
      throw new NodeExecutionError(
        'AI_SERVICE_UNAVAILABLE',
        'El nodo de IA solo se ejecuta en el worker/runtime.',
      );
    }
    const result = await services.ai.generateText({
      credentialId: config.credentialId || undefined,
      model: config.model || undefined,
      system: config.system || undefined,
      prompt: config.prompt,
      maxTokens: config.maxTokens,
    });
    return { output: { text: result.text, model: result.model, provider: result.provider } };
  },
});
