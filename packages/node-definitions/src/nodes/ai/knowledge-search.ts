import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';

const configSchema = z.object({
  query: z.string().min(1, 'Definí qué buscar').max(2000).default('{{trigger.text}}'),
  limit: z.coerce.number().int().min(1).max(10).default(3),
});

type Config = z.infer<typeof configSchema>;

/**
 * Busca en la base de conocimiento del proyecto (FAQ, tono, políticas) los
 * fragmentos más relevantes a la consulta y los deja en `context`, listo para
 * inyectar en el prompt de un nodo de IA ({{nodes.<id>.output.context}}). Así el
 * agente responde fundamentado en el material del negocio (RAG v1 por keywords).
 */
export const knowledgeSearchNode = defineNode<Config, unknown, unknown>({
  type: 'ai.knowledge-search',
  version: 1,
  category: 'ai',
  displayName: 'Buscar conocimiento',
  description: 'Recupera fragmentos de la base de conocimiento del proyecto para fundamentar la respuesta.',
  icon: 'book-open',
  configSchema,
  defaultConfig: { query: '{{trigger.text}}', limit: 3 },
  uiHints: [
    { field: 'query', label: 'Consulta', widget: 'textarea', supportsExpressions: true },
    { field: 'limit', label: 'Cuántos fragmentos', widget: 'number' },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  outputVariables: [
    { path: 'output.context', description: 'Fragmentos relevantes para el prompt' },
    { path: 'output.hits', description: 'Fragmentos con su puntaje' },
    { path: 'output.found', description: 'true si encontró algo' },
  ],
  exportable: true,
  documentation:
    'Cargá la base de conocimiento del proyecto (FAQ, tono, políticas) desde la sección Conocimiento. Poné este nodo antes del nodo de IA y usá {{nodes.<id>.output.context}} en el system o el prompt.',
  async execute({ config, services }) {
    if (!services.knowledge) {
      throw new NodeExecutionError('KNOWLEDGE_SERVICE_UNAVAILABLE', 'La búsqueda de conocimiento solo corre en worker/runtime.');
    }
    const result = await services.knowledge.search({ query: config.query, limit: config.limit });
    return { output: { context: result.context, hits: result.hits, found: result.hits.length > 0 } };
  },
});
