import { z } from 'zod';
import { defineNode, NodeExecutionError } from '../../contract';
import type { AIChatMessage, AIToolCall, AIToolDefinition, NodeServices } from '../../contract';

/** Herramienta HTTP definida por el usuario: el agente la invoca por nombre. */
const userToolSchema = z.object({
  name: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/, 'nombre: minúsculas, números y "_", empezando con letra')
    .max(60),
  description: z.string().min(1).max(500),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: z.string().url().max(2000),
  /** Cómo mandar los argumentos que arma el modelo: query string o body JSON. */
  send: z.enum(['query', 'body']).default('query'),
  credentialId: z.string().optional().default(''),
});

const configSchema = z.object({
  credentialId: z.string().optional().default(''),
  model: z.string().max(100).optional().default(''),
  system: z
    .string()
    .max(20_000)
    .default(
      'Sos un agente que ayuda a resolver la tarea usando las herramientas disponibles. ' +
        'Pensá paso a paso, usá herramientas cuando haga falta y respondé de forma clara y breve.',
    ),
  /** La tarea/objetivo (admite expresiones, p.ej. el mensaje entrante + historial). */
  objective: z.string().min(1, 'Definí el objetivo del agente').max(20_000),
  maxSteps: z.coerce.number().int().min(1).max(15).default(5),
  maxTokens: z.coerce.number().int().min(1).max(8000).default(1024),
  /** Herramienta built-in para llamar cualquier API (con protección SSRF). */
  enableHttp: z.coerce.boolean().default(false),
  /** Herramienta built-in para leer el historial de conversación. */
  enableMemory: z.coerce.boolean().default(false),
  memoryChannel: z.string().max(40).default('whatsapp'),
  memoryContact: z.string().max(200).default('{{trigger.phone}}'),
  /** Herramientas HTTP a medida (se pueden cargar desde el Copilot). */
  tools: z.array(userToolSchema).max(10).default([]),
});

type Config = z.infer<typeof configSchema>;

interface AgentStep {
  tool: string;
  input: Record<string, unknown>;
  result: unknown;
  isError: boolean;
}

const MAX_TOOL_RESULT_CHARS = 8000;

/** Construye las definiciones de herramientas que ve el modelo. */
function buildToolDefs(config: Config): AIToolDefinition[] {
  const tools: AIToolDefinition[] = [];
  if (config.enableHttp) {
    tools.push({
      name: 'http_request',
      description: 'Hacé una llamada HTTP a una API para obtener o enviar datos. Devuelve status y body.',
      parameters: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
          url: { type: 'string', description: 'URL completa (http/https).' },
          headers: { type: 'object', description: 'Headers opcionales.' },
          body: { description: 'Cuerpo para POST/PUT/PATCH (objeto o string).' },
        },
        required: ['method', 'url'],
      },
    });
  }
  if (config.enableMemory) {
    tools.push({
      name: 'get_conversation_history',
      description: 'Traé el historial de conversación con el contacto para tener contexto de lo hablado.',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number', description: 'Cuántos turnos traer (por defecto 10).' } },
      },
    });
  }
  for (const tool of config.tools) {
    tools.push({
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        description: 'Parámetros de la herramienta según su descripción.',
        properties: {},
        additionalProperties: true,
      },
    });
  }
  return tools;
}

/** Ejecuta una herramienta pedida por el modelo usando los servicios del nodo. */
async function executeTool(
  name: string,
  input: Record<string, unknown>,
  config: Config,
  services: NodeServices,
): Promise<{ result: unknown; isError: boolean }> {
  try {
    if (name === 'http_request') {
      if (!services.http) return { result: { error: 'HTTP no disponible' }, isError: true };
      const res = await services.http.request({
        method: String(input.method ?? 'GET'),
        url: String(input.url ?? ''),
        headers: (input.headers as Record<string, string> | undefined) ?? undefined,
        body: input.body,
      });
      return { result: { status: res.status, ok: res.ok, body: res.body }, isError: !res.ok };
    }
    if (name === 'get_conversation_history') {
      if (!services.memory) return { result: { error: 'Memoria no disponible' }, isError: true };
      const hist = await services.memory.loadHistory({
        channel: config.memoryChannel,
        contact: config.memoryContact,
        limit: Number(input.limit) || 10,
      });
      return { result: { transcript: hist.transcript, turns: hist.turns }, isError: false };
    }
    const tool = config.tools.find((t) => t.name === name);
    if (!tool) return { result: { error: `Herramienta desconocida: ${name}` }, isError: true };
    if (!services.http) return { result: { error: 'HTTP no disponible' }, isError: true };
    let url = tool.url;
    let body: unknown;
    if (tool.send === 'query' || tool.method === 'GET') {
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        qs.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
      const query = qs.toString();
      if (query) url += (url.includes('?') ? '&' : '?') + query;
    } else {
      body = input;
    }
    const res = await services.http.request({
      method: tool.method,
      url,
      body,
      credentialId: tool.credentialId || undefined,
    });
    return { result: { status: res.status, ok: res.ok, body: res.body }, isError: !res.ok };
  } catch (error) {
    return { result: { error: error instanceof Error ? error.message : 'Error en la herramienta' }, isError: true };
  }
}

/**
 * Agente de IA: le das un objetivo y un set de herramientas, y corre un loop
 * (el modelo decide → ejecuta herramienta → ve el resultado → sigue) hasta
 * resolver o alcanzar el límite de pasos. Es la primitiva que hace "agente" al
 * sistema. Requiere una credencial de Anthropic para tool-calling real (sin
 * ella, responde en modo desarrollo en un paso). Con OpenAI, v1 responde
 * directo sin herramientas.
 */
export const aiAgentNode = defineNode<Config, unknown, unknown>({
  type: 'ai.agent',
  version: 1,
  category: 'ai',
  displayName: 'Agente IA',
  description: 'Un LLM que razona y usa herramientas en loop hasta cumplir un objetivo.',
  icon: 'bot',
  configSchema,
  defaultConfig: {
    credentialId: '',
    model: '',
    system:
      'Sos un agente que ayuda a resolver la tarea usando las herramientas disponibles. ' +
      'Pensá paso a paso, usá herramientas cuando haga falta y respondé de forma clara y breve.',
    objective: 'Tarea: {{trigger.text}}',
    maxSteps: 5,
    maxTokens: 1024,
    enableHttp: false,
    enableMemory: false,
    memoryChannel: 'whatsapp',
    memoryContact: '{{trigger.phone}}',
    tools: [],
  },
  uiHints: [
    {
      field: 'credentialId',
      label: 'Credencial de IA',
      widget: 'credential',
      credentialTypes: ['anthropic', 'openai'],
      helpText: 'Anthropic para agente con herramientas real. Sin credencial: modo desarrollo.',
    },
    { field: 'model', label: 'Modelo', widget: 'text', placeholder: 'claude-sonnet-4-6 / claude-opus-4-8' },
    { field: 'system', label: 'Instrucciones del agente (system)', widget: 'textarea', supportsExpressions: true },
    { field: 'objective', label: 'Objetivo / tarea', widget: 'textarea', supportsExpressions: true },
    { field: 'maxSteps', label: 'Máx. pasos (herramientas)', widget: 'number', helpText: 'Límite para que no se dispare el costo.' },
    { field: 'maxTokens', label: 'Máx. tokens por paso', widget: 'number' },
    { field: 'enableHttp', label: 'Herramienta: llamar APIs (HTTP)', widget: 'switch' },
    { field: 'enableMemory', label: 'Herramienta: leer historial', widget: 'switch' },
    { field: 'memoryContact', label: 'Contacto (para el historial)', widget: 'text', supportsExpressions: true },
  ],
  inputs: [{ id: 'main', label: 'Entrada' }],
  outputs: [{ id: 'main', label: 'Salida' }],
  credentials: [{ type: 'anthropic', required: false }],
  outputVariables: [
    { path: 'output.text', description: 'Respuesta final del agente' },
    { path: 'output.steps', description: 'Traza de herramientas usadas' },
    { path: 'output.stepsUsed', description: 'Cuántos pasos usó' },
  ],
  exportable: true,
  documentation:
    'Le das un objetivo y herramientas (HTTP, historial, o APIs a medida) y el agente decide qué usar. El límite de pasos evita loops infinitos y controla el costo. Combinalo con memoria (Cargar historial) para agentes que recuerdan.',
  async execute({ config, services, signal }) {
    if (!services.ai) {
      throw new NodeExecutionError('AI_SERVICE_UNAVAILABLE', 'El nodo Agente solo se ejecuta en el worker/runtime.');
    }
    const toolDefs = buildToolDefs(config);
    const messages: AIChatMessage[] = [{ role: 'user', content: config.objective }];
    const steps: AgentStep[] = [];
    let finalText = '';
    let stepsUsed = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let provider = 'dev-echo';
    let model = 'dev-echo';

    for (let step = 0; step < config.maxSteps; step += 1) {
      if (signal.aborted) break;
      const result = await services.ai.chat({
        credentialId: config.credentialId || undefined,
        model: config.model || undefined,
        system: config.system,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        maxTokens: config.maxTokens,
      });
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      provider = result.provider;
      model = result.model;
      stepsUsed = step + 1;
      if (result.text) finalText = result.text;

      if (result.toolCalls.length === 0) break;

      messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls as AIToolCall[]) {
        const { result: toolResult, isError } = await executeTool(call.name, call.input, config, services);
        steps.push({ tool: call.name, input: call.input, result: toolResult, isError });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          toolResult: JSON.stringify(toolResult).slice(0, MAX_TOOL_RESULT_CHARS),
          isError,
        });
      }
    }

    if (!finalText) {
      finalText = '(el agente alcanzó el límite de pasos sin cerrar una respuesta final)';
    }

    return {
      output: { text: finalText, steps, stepsUsed, provider, model, inputTokens, outputTokens },
    };
  },
});
