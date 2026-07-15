import type { CopilotChatMessage } from './schemas';
import { BUILD_PROJECT_TOOL, PROPOSE_CHANGES_TOOL } from './schemas';

/**
 * Abstracción de proveedor de IA para el copilot. Distinta del AIService de los
 * nodos: acá hay conversación con historial, tool-calling y streaming. La
 * implementación real es Claude (Anthropic); el fallback dev permite usar todo
 * el sistema sin API key. Cambiar de proveedor no toca la API ni la web.
 */

export const DEFAULT_COPILOT_MODEL = 'claude-opus-4-8';

export interface CopilotChatRequest {
  /** System prompt completo (rol + contexto ya redactado). */
  system: string;
  messages: CopilotChatMessage[];
  maxTokens?: number;
  /** Exponer la herramienta propose_changes (proponer cambios a un flujo). */
  enableProposals?: boolean;
  /** Exponer la herramienta build_project (armar varios flujos + conocimiento). */
  enableProjectBuild?: boolean;
  /** Forzar que el modelo use esta herramienta (por nombre). */
  forceTool?: string;
  signal?: AbortSignal;
}

export interface CopilotStreamHandlers {
  onText?: (delta: string) => void;
  onThinking?: (delta: string) => void;
}

export interface CopilotChatResult {
  text: string;
  /** Input crudo de propose_changes; el llamador lo valida con parseChangeSet. */
  proposalRaw?: unknown;
  /** Herramienta que llamó el modelo (nombre + input crudo), sea cual sea. */
  toolCall?: { name: string; input: unknown };
  usage: { inputTokens: number; outputTokens: number };
  stopReason: string | null;
  provider: string;
  model: string;
}

export interface CopilotProvider {
  readonly id: string;
  readonly model: string;
  /** true si habla con un modelo real; false para el fallback dev. */
  readonly isReal: boolean;
  chat(request: CopilotChatRequest, handlers?: CopilotStreamHandlers): Promise<CopilotChatResult>;
}

export class CopilotProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CopilotProviderError';
  }
}

const approxTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

/* ── Costo estimado (USD por 1M tokens) ─────────────────────── */

const PRICING: Record<string, { in: number; out: number }> = {
  'claude-opus': { in: 5, out: 25 },
  'claude-sonnet': { in: 3, out: 15 },
  'claude-haiku': { in: 1, out: 5 },
  'claude-fable': { in: 10, out: 50 },
  dev: { in: 0, out: 0 },
};

function priceFor(model: string): { in: number; out: number } {
  const key = Object.keys(PRICING).find((k) => model.startsWith(k));
  return (key && PRICING[key]) || { in: 0, out: 0 };
}

export function estimateCopilotCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = priceFor(model);
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
}

/* ── Proveedor Claude (Anthropic Messages API, SSE) ─────────── */

interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  content_block?: { type?: string; name?: string };
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  usage?: { output_tokens?: number };
  error?: { message?: string };
}

export interface ClaudeCopilotProviderOptions {
  apiKey: string;
  model?: string;
  /** Habilita adaptive thinking (más calidad, más latencia). */
  thinking?: boolean;
  baseUrl?: string;
}

export class ClaudeCopilotProvider implements CopilotProvider {
  readonly id = 'claude';
  readonly isReal = true;
  readonly model: string;
  private readonly apiKey: string;
  private readonly thinking: boolean;
  private readonly baseUrl: string;

  constructor(options: ClaudeCopilotProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_COPILOT_MODEL;
    this.thinking = options.thinking ?? false;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
  }

  async chat(request: CopilotChatRequest, handlers?: CopilotStreamHandlers): Promise<CopilotChatResult> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 4096,
      system: request.system,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    };
    const tools: unknown[] = [];
    if (request.enableProposals) tools.push(PROPOSE_CHANGES_TOOL);
    if (request.enableProjectBuild) tools.push(BUILD_PROJECT_TOOL);
    if (tools.length > 0) {
      body.tools = tools;
      if (request.forceTool) body.tool_choice = { type: 'tool', name: request.forceTool };
    }
    if (this.thinking) body.thinking = { type: 'adaptive', display: 'summarized' };

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: request.signal,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new CopilotProviderError(`Anthropic respondió HTTP ${response.status}: ${errText.slice(0, 300)}`);
    }
    if (!response.body) throw new CopilotProviderError('Anthropic respondió sin cuerpo de stream.');

    let text = '';
    let inputTokens = 0;
    let outputTokens = 0;
    let stopReason: string | null = null;
    let toolCall: { name: string; input: unknown } | undefined;
    const blocks = new Map<number, { type?: string; name?: string; jsonBuf: string }>();

    const decoder = new TextDecoder();
    let buffer = '';
    const stream = response.body as unknown as AsyncIterable<Uint8Array>;
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let event: AnthropicStreamEvent;
        try {
          event = JSON.parse(payload) as AnthropicStreamEvent;
        } catch {
          continue;
        }
        switch (event.type) {
          case 'message_start':
            inputTokens = event.message?.usage?.input_tokens ?? 0;
            outputTokens = event.message?.usage?.output_tokens ?? 0;
            break;
          case 'content_block_start':
            if (event.index !== undefined) {
              blocks.set(event.index, {
                type: event.content_block?.type,
                name: event.content_block?.name,
                jsonBuf: '',
              });
            }
            break;
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta?.type === 'text_delta' && delta.text) {
              text += delta.text;
              handlers?.onText?.(delta.text);
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              handlers?.onThinking?.(delta.thinking);
            } else if (delta?.type === 'input_json_delta' && event.index !== undefined) {
              const block = blocks.get(event.index);
              if (block) block.jsonBuf += delta.partial_json ?? '';
            }
            break;
          }
          case 'content_block_stop': {
            if (event.index === undefined) break;
            const block = blocks.get(event.index);
            if (block?.type === 'tool_use' && block.name) {
              try {
                toolCall = { name: block.name, input: JSON.parse(block.jsonBuf || '{}') };
              } catch {
                /* input inválido: queda undefined, el llamador lo maneja */
              }
            }
            break;
          }
          case 'message_delta':
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
            if (event.usage?.output_tokens !== undefined) outputTokens = event.usage.output_tokens;
            break;
          case 'error':
            throw new CopilotProviderError(`Anthropic error: ${event.error?.message ?? 'desconocido'}`);
          default:
            break;
        }
      }
    }

    return {
      text,
      toolCall,
      proposalRaw: toolCall?.name === PROPOSE_CHANGES_TOOL.name ? toolCall.input : undefined,
      usage: { inputTokens, outputTokens },
      stopReason,
      provider: this.id,
      model: this.model,
    };
  }
}

/* ── Proveedor dev (sin API key) ────────────────────────────── */

/**
 * Fallback determinista para usar el copilot sin credencial de IA. No razona:
 * confirma el mensaje y aclara que hay que configurar la API key de Claude.
 */
export class DevCopilotProvider implements CopilotProvider {
  readonly id = 'dev';
  readonly isReal = false;
  readonly model: string;

  constructor(model = 'dev-echo') {
    this.model = model;
  }

  async chat(request: CopilotChatRequest, handlers?: CopilotStreamHandlers): Promise<CopilotChatResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const snippet = (lastUser?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const text =
      `[modo desarrollo · sin IA real] Recibí: "${snippet}". ` +
      `Configurá ANTHROPIC_API_KEY (o COPILOT_ANTHROPIC_API_KEY) para respuestas reales de Claude.`;
    // Emitir en trozos para ejercitar el streaming de la UI también en dev.
    for (const word of text.split(' ')) handlers?.onText?.(`${word} `);
    return {
      text,
      usage: { inputTokens: approxTokens(request.system + snippet), outputTokens: approxTokens(text) },
      stopReason: 'end_turn',
      provider: this.id,
      model: this.model,
    };
  }
}

/* ── Fábrica ────────────────────────────────────────────────── */

export interface CopilotProviderConfig {
  provider?: 'claude' | 'dev';
  apiKey?: string;
  model?: string;
  thinking?: boolean;
}

export function createCopilotProvider(config: CopilotProviderConfig): CopilotProvider {
  const provider = config.provider ?? 'claude';
  if (provider === 'claude' && config.apiKey) {
    return new ClaudeCopilotProvider({
      apiKey: config.apiKey,
      model: config.model ?? DEFAULT_COPILOT_MODEL,
      thinking: config.thinking ?? false,
    });
  }
  return new DevCopilotProvider(config.model && provider === 'dev' ? config.model : 'dev-echo');
}
