/**
 * Servicios del runtime exportado (sin base de datos): HTTP con guarda SSRF
 * e IA con capa de proveedores. Las credenciales se resuelven desde variables
 * de entorno según el mapa `credentials.json` (nunca contienen secretos).
 */
import { lookup } from 'node:dns/promises';
import { createTransport } from 'nodemailer';
import { checkSsrf, ssrfPolicyFromEnv } from '@ifnodes/shared';
import { sendWhatsAppText, rankKnowledge, type KnowledgeChunkLike } from '@ifnodes/node-definitions';
import { InMemoryStore, type RuntimeStore } from './store';
import type {
  AIChatInput,
  AIChatMessage,
  AIChatResult,
  AIClassifyInput,
  AIClassifyResult,
  AIGenerateInput,
  AIGenerateResult,
  AIToolCall,
  ContactIdentity,
  ContactUpsertInput,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  EmailSendInput,
  EmailSendResult,
  HttpRequestInput,
  HttpResult,
  MemoryLoadInput,
  MemoryLoadResult,
  MemorySaveInput,
  MemorySaveResult,
  MemorySetStatusInput,
  NodeServices,
  WhatsAppSendInput,
  WhatsAppSendResult,
} from '@ifnodes/node-definitions';

/** Mapa credentialId → { slug, fields: { key: {env}|{value} } } */
export interface CredentialManifest {
  [credentialId: string]: {
    slug: string;
    fields: Record<string, { env?: string; value?: string }>;
  };
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;

function resolveCredential(manifest: CredentialManifest, credentialId: string) {
  const entry = manifest[credentialId];
  if (!entry) return null;
  const data: Record<string, string> = {};
  for (const [key, field] of Object.entries(entry.fields)) {
    data[key] = field.env ? (process.env[field.env] ?? '') : (field.value ?? '');
  }
  return { slug: entry.slug, data };
}

async function assertUrlAllowed(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`URL inválida: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Protocolo no permitido: ${url.protocol}`);
  }
  const policy = ssrfPolicyFromEnv(process.env);
  const records = await lookup(url.hostname, { all: true }).catch(() => {
    throw new Error(`No se pudo resolver el host ${url.hostname}`);
  });
  const reason = checkSsrf(url.hostname, records.map((r) => r.address), policy);
  if (reason) throw new Error(reason);
  return url;
}

const approxTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

async function callAnthropic(apiKey: string, model: string, input: AIGenerateInput): Promise<AIGenerateResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 1024,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Anthropic respondió HTTP ${response.status}`);
  const json = (await response.json()) as {
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };
  const text = json.content.filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
  return {
    text,
    provider: 'anthropic',
    model,
    inputTokens: json.usage?.input_tokens ?? approxTokens(input.prompt),
    outputTokens: json.usage?.output_tokens ?? approxTokens(text),
  };
}

async function callOpenAI(apiKey: string, model: string, input: AIGenerateInput): Promise<AIGenerateResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 1024,
      messages: [
        ...(input.system ? [{ role: 'system', content: input.system }] : []),
        { role: 'user', content: input.prompt },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`OpenAI respondió HTTP ${response.status}`);
  const json = (await response.json()) as {
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  const text = json.choices[0]?.message.content ?? '';
  return {
    text,
    provider: 'openai',
    model,
    inputTokens: json.usage?.prompt_tokens ?? approxTokens(input.prompt),
    outputTokens: json.usage?.completion_tokens ?? approxTokens(text),
  };
}

function devEchoGenerate(input: AIGenerateInput): AIGenerateResult {
  const snippet = input.prompt.replace(/\s+/g, ' ').trim().slice(0, 200);
  const text = `[modo desarrollo · sin IA real] Recibí: "${snippet}". Configurá una credencial de IA para respuestas reales.`;
  return { text, provider: 'dev-echo', model: 'dev-echo', inputTokens: approxTokens(input.prompt), outputTokens: approxTokens(text) };
}

/* ── Tool-calling (nodo Agente) ─────────────────────────────── */

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

function toAnthropicChatMessages(messages: AIChatMessage[]): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i]!;
    if (message.role === 'user') {
      out.push({ role: 'user', content: message.content ?? '' });
      i += 1;
    } else if (message.role === 'assistant') {
      const blocks: unknown[] = [];
      if (message.content) blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) {
        blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
      }
      out.push({ role: 'assistant', content: blocks.length > 0 ? blocks : (message.content ?? '') });
      i += 1;
    } else {
      const blocks: unknown[] = [];
      while (i < messages.length && messages[i]!.role === 'tool') {
        const tool = messages[i]!;
        blocks.push({
          type: 'tool_result',
          tool_use_id: tool.toolCallId,
          content: tool.toolResult ?? '',
          ...(tool.isError ? { is_error: true } : {}),
        });
        i += 1;
      }
      out.push({ role: 'user', content: blocks });
    }
  }
  return out;
}

async function callAnthropicChat(apiKey: string, model: string, input: AIChatInput): Promise<AIChatResult> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: input.maxTokens ?? 1024,
    messages: toAnthropicChatMessages(input.messages),
  };
  if (input.system) body.system = input.system;
  if (input.tools && input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  }
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Anthropic respondió HTTP ${response.status}`);
  const json = (await response.json()) as {
    content: AnthropicBlock[];
    stop_reason?: string;
    usage?: { input_tokens: number; output_tokens: number };
  };
  let text = '';
  const toolCalls: AIToolCall[] = [];
  for (const block of json.content ?? []) {
    if (block.type === 'text') text += block.text ?? '';
    else if (block.type === 'tool_use' && block.id && block.name) {
      toolCalls.push({ id: block.id, name: block.name, input: block.input ?? {} });
    }
  }
  return {
    text,
    toolCalls,
    stopReason: json.stop_reason ?? 'end_turn',
    provider: 'anthropic',
    model,
    inputTokens: json.usage?.input_tokens ?? approxTokens(JSON.stringify(input.messages)),
    outputTokens: json.usage?.output_tokens ?? approxTokens(text),
  };
}

function devEchoChat(input: AIChatInput): AIChatResult {
  const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
  const snippet = (lastUser?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
  const text = `[modo desarrollo · sin IA real] El agente respondería en base a: "${snippet}". Configurá una credencial de Anthropic para el modo agente real.`;
  return { text, toolCalls: [], stopReason: 'end_turn', provider: 'dev-echo', model: 'dev-echo', inputTokens: approxTokens(lastUser?.content ?? ''), outputTokens: approxTokens(text) };
}

/* ── Memoria de conversación (en proceso, efímera) ──────────────
 * El runtime exportado no tiene DB por defecto: la memoria vive en el proceso
 * y se reinicia si el proceso se reinicia. Alcanza para conversaciones activas;
 * para persistencia real se conecta una DB en una fase futura. El store es a
 * nivel de módulo para sobrevivir entre requests dentro del mismo proceso.
 */
const ROLE_LABEL: Record<string, string> = { user: 'Cliente', assistant: 'Bot', system: 'Sistema', operator: 'Coordinador' };
const memoryKey = (channel: string, contact: string) => `${channel}:${contact}`;

export function buildRuntimeServices(
  credentials: CredentialManifest,
  knowledge: KnowledgeChunkLike[] = [],
  store: RuntimeStore = new InMemoryStore(),
): NodeServices {
  const memory: NodeServices['memory'] = {
    async loadHistory(input: MemoryLoadInput): Promise<MemoryLoadResult> {
      const { turns, status } = await store.memoryLoad(input.channel, input.contact, input.limit ?? 10);
      const transcript = turns.map((t) => `${ROLE_LABEL[t.role] ?? t.role}: ${t.text}`).join('\n');
      return { conversationId: memoryKey(input.channel, input.contact), turns, transcript, status };
    },
    async saveTurn(input: MemorySaveInput): Promise<MemorySaveResult> {
      await store.memorySave(input.channel, input.contact, input.role, input.text);
      return { conversationId: memoryKey(input.channel, input.contact) };
    },
    async setStatus(input: MemorySetStatusInput): Promise<{ conversationId: string }> {
      await store.memorySetStatus(input.channel, input.contact, input.status);
      return { conversationId: memoryKey(input.channel, input.contact) };
    },
  };

  const contacts: NodeServices['contacts'] = {
    find: (identity: ContactIdentity) => store.contactFind(identity),
    upsert: (input: ContactUpsertInput) => store.contactUpsert(input),
  };

  const http: NodeServices['http'] = {
    async request(input: HttpRequestInput): Promise<HttpResult> {
      const headers: Record<string, string> = { ...(input.headers ?? {}) };
      if (input.credentialId) {
        const cred = resolveCredential(credentials, input.credentialId);
        if (cred?.slug === 'http-bearer' && cred.data.token) headers['authorization'] = `Bearer ${cred.data.token}`;
        else if (cred?.slug === 'api-key' && cred.data.headerName && cred.data.key) headers[cred.data.headerName] = cred.data.key;
      }
      let currentUrl = input.url;
      let redirects = 0;
      for (;;) {
        const url = await assertUrlAllowed(currentUrl);
        const hasBody = input.method !== 'GET' && input.body !== undefined;
        const response = await fetch(url, {
          method: input.method,
          headers: hasBody ? { 'content-type': 'application/json', ...headers } : headers,
          body: hasBody ? (typeof input.body === 'string' ? input.body : JSON.stringify(input.body)) : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
        });
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
          if (++redirects > MAX_REDIRECTS) throw new Error('Demasiadas redirecciones.');
          currentUrl = new URL(response.headers.get('location') as string, url).toString();
          continue;
        }
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_BYTES) throw new Error('Respuesta demasiado grande.');
        const bodyText = new TextDecoder().decode(buffer);
        let body: unknown = bodyText;
        if ((response.headers.get('content-type') ?? '').includes('application/json')) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            body = bodyText;
          }
        }
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => (responseHeaders[key] = value));
        return { status: response.status, ok: response.ok, headers: responseHeaders, body };
      }
    },
  };

  const ai: NodeServices['ai'] = {
    async generateText(input: AIGenerateInput): Promise<AIGenerateResult> {
      const cred = input.credentialId ? resolveCredential(credentials, input.credentialId) : null;
      if (cred?.slug === 'anthropic' && cred.data.apiKey) return callAnthropic(cred.data.apiKey, input.model || 'claude-sonnet-4-6', input);
      if (cred?.slug === 'openai' && cred.data.apiKey) return callOpenAI(cred.data.apiKey, input.model || 'gpt-4o-mini', input);
      return devEchoGenerate(input);
    },
    async classify(input: AIClassifyInput): Promise<AIClassifyResult> {
      const cred = input.credentialId ? resolveCredential(credentials, input.credentialId) : null;
      if ((cred?.slug === 'anthropic' || cred?.slug === 'openai') && cred.data.apiKey) {
        const prompt = `Clasificá el mensaje en UNA categoría: ${input.categories.join(', ')}.\nRespondé SOLO el nombre exacto.\n\nMensaje: ${input.text}`;
        const gen =
          cred.slug === 'anthropic'
            ? await callAnthropic(cred.data.apiKey, input.model || 'claude-sonnet-4-6', { prompt, maxTokens: 20 })
            : await callOpenAI(cred.data.apiKey, input.model || 'gpt-4o-mini', { prompt, maxTokens: 20 });
        const answer = gen.text.trim().toLowerCase();
        const matched =
          input.categories.find((c) => c.toLowerCase() === answer) ??
          input.categories.find((c) => answer.includes(c.toLowerCase())) ??
          input.categories[0] ??
          'otro';
        return { category: matched, provider: gen.provider, model: gen.model };
      }
      const text = input.text.toLowerCase();
      const match = input.categories.find((c) => text.includes(c.toLowerCase()));
      return { category: match ?? input.categories[0] ?? 'otro', provider: 'dev-echo', model: 'dev-echo' };
    },
    async chat(input: AIChatInput): Promise<AIChatResult> {
      const cred = input.credentialId ? resolveCredential(credentials, input.credentialId) : null;
      if (cred?.slug === 'anthropic' && cred.data.apiKey) {
        return callAnthropicChat(cred.data.apiKey, input.model || 'claude-sonnet-4-6', input);
      }
      if (cred?.slug === 'openai' && cred.data.apiKey) {
        const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
        const gen = await callOpenAI(cred.data.apiKey, input.model || 'gpt-4o-mini', {
          prompt: lastUser?.content ?? '',
          system: input.system,
          maxTokens: input.maxTokens,
        });
        return { text: gen.text, toolCalls: [], stopReason: 'end_turn', provider: gen.provider, model: gen.model, inputTokens: gen.inputTokens, outputTokens: gen.outputTokens };
      }
      return devEchoChat(input);
    },
  };

  const whatsapp: NodeServices['whatsapp'] = {
    async sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
      const cred = input.credentialId ? resolveCredential(credentials, input.credentialId) : null;
      if (cred?.slug === 'whatsapp-cloud' && cred.data.accessToken && cred.data.phoneNumberId) {
        const { messageId } = await sendWhatsAppText({
          accessToken: cred.data.accessToken,
          phoneNumberId: cred.data.phoneNumberId,
          to: input.to,
          text: input.text,
        });
        return { to: input.to, text: input.text, sent: true, simulated: false, messageId };
      }
      return { to: input.to, text: input.text, sent: false, simulated: true };
    },
  };

  const email: NodeServices['email'] = {
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      const cred = input.credentialId ? resolveCredential(credentials, input.credentialId) : null;
      if (cred?.slug === 'smtp' && cred.data.host && cred.data.user) {
        const port = Number(cred.data.port) || 587;
        const transport = createTransport({
          host: cred.data.host,
          port,
          secure: port === 465,
          auth: { user: cred.data.user, pass: cred.data.password },
        });
        const info = await transport.sendMail({
          from: input.from || cred.data.user,
          to: input.to,
          subject: input.subject,
          text: input.text || undefined,
          html: input.html || undefined,
        });
        return { to: input.to, subject: input.subject, sent: true, simulated: false, messageId: info.messageId };
      }
      return { to: input.to, subject: input.subject, sent: false, simulated: true };
    },
  };

  const knowledgeService: NodeServices['knowledge'] = {
    async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
      return rankKnowledge(knowledge, input.query, input.limit ?? 3);
    },
  };

  return { http, ai, whatsapp, memory, email, contacts, knowledge: knowledgeService };
}
