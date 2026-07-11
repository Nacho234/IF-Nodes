import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const headerSchema = z.object({ key: z.string().max(200), value: z.string().max(2000) });

const configSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
  url: z.string().min(1, 'La URL es obligatoria').max(2000),
  headers: z.array(headerSchema).max(30).default([]),
  /** Cuerpo JSON (texto); admite expresiones. Ignorado en GET. */
  body: z.string().max(20_000).optional().default(''),
  /** Credencial opcional (Bearer / API key) que el worker inyecta de forma segura */
  credentialId: z.string().optional().default(''),
});

type Config = z.infer<typeof configSchema>;

export const httpRequestNode = defineNode<Config, unknown, unknown>({
  type: 'integrations.http-request',
  version: 1,
  category: 'integrations',
  displayName: 'HTTP Request',
  description: 'Llama a una API externa (con protección contra redes internas).',
  icon: 'globe',
  configSchema,
  defaultConfig: { method: 'GET', url: 'https://api.ejemplo.com/datos', headers: [], body: '', credentialId: '' },
  uiHints: [
    {
      field: 'method',
      label: 'Método',
      widget: 'select',
      options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => ({ value: m, label: m })),
    },
    { field: 'url', label: 'URL', widget: 'text', supportsExpressions: true, placeholder: 'https://…' },
    {
      field: 'credentialId',
      label: 'Credencial',
      widget: 'credential',
      credentialTypes: ['http-bearer', 'api-key'],
      helpText: 'Opcional. Se agrega como Authorization/header de forma segura.',
    },
    { field: 'headers', label: 'Headers', widget: 'keyvalue', supportsExpressions: true },
    {
      field: 'body',
      label: 'Cuerpo (JSON)',
      widget: 'code',
      supportsExpressions: true,
      helpText: 'Se envía como application/json. Ignorado en GET.',
    },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'http-bearer', required: false }],
  outputVariables: [
    { path: 'output.status', description: 'Código HTTP' },
    { path: 'output.body', description: 'Cuerpo de la respuesta (JSON o texto)' },
  ],
  exportable: true,
  documentation:
    'El worker resuelve DNS y bloquea IPs internas/privadas/metadata antes de conectar (política SSRF). Timeout y tamaño de respuesta acotados.',
  async execute({ config, services }) {
    if (!services.http) {
      throw new NodeExecutionError(
        'HTTP_SERVICE_UNAVAILABLE',
        'El nodo HTTP solo se ejecuta en el worker/runtime (no en el simulador puro).',
      );
    }
    const headers: Record<string, string> = {};
    for (const { key, value } of config.headers) {
      if (key.trim()) headers[key.trim()] = value;
    }
    let body: unknown;
    if (config.method !== 'GET' && config.body.trim()) {
      try {
        body = JSON.parse(config.body);
      } catch {
        body = config.body; // se envía como texto si no es JSON válido
      }
    }
    const result = await services.http.request({
      method: config.method,
      url: config.url,
      headers,
      body,
      credentialId: config.credentialId || undefined,
    });
    return { output: { status: result.status, ok: result.ok, headers: result.headers, body: result.body } };
  },
});
