/**
 * Implementación de los servicios que el motor inyecta en los nodos
 * (context.services): HTTP con guarda SSRF e IA con capa de proveedores.
 * Se construyen por ejecución para poder atribuir uso/credenciales al contexto.
 */
import { lookup } from 'node:dns/promises';
import { createTransport } from 'nodemailer';
import type { Prisma, PrismaClient } from '@ifnodes/database';
import { checkSsrf, ssrfPolicyFromEnv } from '@ifnodes/shared';
import { decryptSecret } from '@ifnodes/shared/dist/crypto';
import { sendWhatsAppText, rankKnowledge } from '@ifnodes/node-definitions';
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
  ContactRecord,
  ContactUpsertInput,
  ConversationRole,
  ConversationTurn,
  EmailSendInput,
  EmailSendResult,
  HttpRequestInput,
  HttpResult,
  KnowledgeSearchInput,
  KnowledgeSearchResult,
  MemoryLoadInput,
  MemoryLoadResult,
  MemorySaveInput,
  MemorySaveResult,
  MemorySetStatusInput,
  NodeServices,
  WhatsAppSendInput,
  WhatsAppSendResult,
} from '@ifnodes/node-definitions';

interface ServiceContext {
  prisma: PrismaClient;
  projectId: string;
  executionId: string;
}

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB
const MAX_REDIRECTS = 5;

/* ── Credenciales (decrypt + cache por ejecución) ───────────── */

function makeCredentialResolver(ctx: ServiceContext) {
  const cache = new Map<string, { slug: string; data: Record<string, string> } | null>();
  return async (credentialId: string) => {
    if (cache.has(credentialId)) return cache.get(credentialId) ?? null;
    const row = await ctx.prisma.credential.findFirst({
      where: { id: credentialId, active: true },
      include: { integration: true },
    });
    if (!row) {
      cache.set(credentialId, null);
      return null;
    }
    const data = JSON.parse(decryptSecret(row.encryptedData)) as Record<string, string>;
    const value = { slug: row.integration.slug, data };
    cache.set(credentialId, value);
    return value;
  };
}

/* ── HTTP con SSRF ──────────────────────────────────────────── */

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
  const reason = checkSsrf(
    url.hostname,
    records.map((r) => r.address),
    policy,
  );
  if (reason) throw new Error(reason);
  return url;
}

function makeHttpService(ctx: ServiceContext): NodeServices['http'] {
  const resolveCredential = makeCredentialResolver(ctx);
  return {
    async request(input: HttpRequestInput): Promise<HttpResult> {
      const headers: Record<string, string> = { ...(input.headers ?? {}) };

      if (input.credentialId) {
        const cred = await resolveCredential(input.credentialId);
        if (cred?.slug === 'http-bearer' && cred.data.token) {
          headers['authorization'] = `Bearer ${cred.data.token}`;
        } else if (cred?.slug === 'api-key' && cred.data.headerName && cred.data.key) {
          headers[cred.data.headerName] = cred.data.key;
        }
      }

      let currentUrl = input.url;
      let redirects = 0;
      for (;;) {
        const url = await assertUrlAllowed(currentUrl);
        const hasBody = input.method !== 'GET' && input.body !== undefined;
        const response = await fetch(url, {
          method: input.method,
          headers: hasBody ? { 'content-type': 'application/json', ...headers } : headers,
          body: hasBody
            ? typeof input.body === 'string'
              ? input.body
              : JSON.stringify(input.body)
            : undefined,
          redirect: 'manual',
          signal: AbortSignal.timeout(input.timeoutMs ?? 15_000),
        });

        // Re-validar cada redirección contra la política SSRF
        if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
          if (++redirects > MAX_REDIRECTS) throw new Error('Demasiadas redirecciones.');
          currentUrl = new URL(response.headers.get('location') as string, url).toString();
          continue;
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_RESPONSE_BYTES) {
          throw new Error(`Respuesta demasiado grande (> ${MAX_RESPONSE_BYTES} bytes).`);
        }
        const text = new TextDecoder().decode(buffer);
        let body: unknown = text;
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          try {
            body = JSON.parse(text);
          } catch {
            body = text;
          }
        }
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        return { status: response.status, ok: response.ok, headers: responseHeaders, body };
      }
    },
  };
}

/* ── IA: capa de proveedores ────────────────────────────────── */

// Precio aproximado USD por 1M tokens (entrada/salida) para estimar costo
const PRICING: Record<string, { in: number; out: number }> = {
  anthropic: { in: 3, out: 15 },
  openai: { in: 2.5, out: 10 },
  'dev-echo': { in: 0, out: 0 },
};

function estimateCost(provider: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[provider] ?? { in: 0, out: 0 };
  return (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
}

// Aproximación de tokens sin dependencias (≈ 4 chars por token)
const approxTokens = (text: string) => Math.max(1, Math.ceil(text.length / 4));

async function callAnthropic(
  apiKey: string,
  model: string,
  input: AIGenerateInput,
): Promise<AIGenerateResult> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: input.maxTokens ?? 1024,
      system: input.system,
      messages: [{ role: 'user', content: input.prompt }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Anthropic respondió HTTP ${response.status}`);
  }
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

/* ── Tool-calling (nodo Agente) ─────────────────────────────── */

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/** Mapea los mensajes neutrales al formato de la Messages API (agrupa los
 *  tool_result consecutivos en un único mensaje de usuario, como exige Anthropic). */
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
    body.tools = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
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
  return {
    text,
    toolCalls: [],
    stopReason: 'end_turn',
    provider: 'dev-echo',
    model: 'dev-echo',
    inputTokens: approxTokens(lastUser?.content ?? ''),
    outputTokens: approxTokens(text),
  };
}

/** Proveedor de desarrollo: determinista, sin costo, claramente identificado. */
function devEchoGenerate(input: AIGenerateInput): AIGenerateResult {
  const snippet = input.prompt.replace(/\s+/g, ' ').trim().slice(0, 200);
  const text = `[modo desarrollo · sin IA real] Recibí tu mensaje y respondería en base a: "${snippet}". Configurá una credencial de IA para respuestas reales.`;
  return {
    text,
    provider: 'dev-echo',
    model: 'dev-echo',
    inputTokens: approxTokens(input.prompt),
    outputTokens: approxTokens(text),
  };
}

function devEchoClassify(input: AIClassifyInput): AIClassifyResult {
  const text = input.text.toLowerCase();
  const match = input.categories.find((category) => text.includes(category.toLowerCase()));
  return {
    category: match ?? input.categories[0] ?? 'otro',
    provider: 'dev-echo',
    model: 'dev-echo',
  };
}

function makeAIService(ctx: ServiceContext, nodeIdRef: { current: string }): NodeServices['ai'] {
  const resolveCredential = makeCredentialResolver(ctx);

  const record = async (result: { provider: string; model: string; inputTokens: number; outputTokens: number }) => {
    await ctx.prisma.usageRecord
      .create({
        data: {
          projectId: ctx.projectId,
          executionId: ctx.executionId,
          nodeId: nodeIdRef.current,
          provider: result.provider,
          model: result.model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCost: estimateCost(result.provider, result.inputTokens, result.outputTokens),
        },
      })
      .catch(() => undefined);
  };

  const resolveProvider = async (credentialId?: string) => {
    if (!credentialId) return null;
    return resolveCredential(credentialId);
  };

  return {
    async generateText(input: AIGenerateInput): Promise<AIGenerateResult> {
      const cred = await resolveProvider(input.credentialId);
      let result: AIGenerateResult;
      if (cred?.slug === 'anthropic' && cred.data.apiKey) {
        result = await callAnthropic(cred.data.apiKey, input.model || 'claude-sonnet-4-6', input);
      } else if (cred?.slug === 'openai' && cred.data.apiKey) {
        result = await callOpenAI(cred.data.apiKey, input.model || 'gpt-4o-mini', input);
      } else {
        result = devEchoGenerate(input);
      }
      await record(result);
      return result;
    },

    async classify(input: AIClassifyInput): Promise<AIClassifyResult> {
      const cred = await resolveProvider(input.credentialId);
      if ((cred?.slug === 'anthropic' || cred?.slug === 'openai') && cred.data.apiKey) {
        const prompt = `Clasificá el siguiente mensaje en UNA de estas categorías: ${input.categories.join(', ')}.\nRespondé SOLO con el nombre exacto de la categoría, sin explicaciones.\n\nMensaje: ${input.text}`;
        const generation =
          cred.slug === 'anthropic'
            ? await callAnthropic(cred.data.apiKey, input.model || 'claude-sonnet-4-6', { prompt, maxTokens: 20 })
            : await callOpenAI(cred.data.apiKey, input.model || 'gpt-4o-mini', { prompt, maxTokens: 20 });
        await record(generation);
        const answer = generation.text.trim().toLowerCase();
        const matched =
          input.categories.find((c) => c.toLowerCase() === answer) ??
          input.categories.find((c) => answer.includes(c.toLowerCase())) ??
          input.categories[0] ??
          'otro';
        return { category: matched, provider: generation.provider, model: generation.model };
      }
      const result = devEchoClassify(input);
      await record({ ...result, inputTokens: approxTokens(input.text), outputTokens: 1 });
      return result;
    },

    async chat(input: AIChatInput): Promise<AIChatResult> {
      const cred = await resolveProvider(input.credentialId);
      let result: AIChatResult;
      if (cred?.slug === 'anthropic' && cred.data.apiKey) {
        result = await callAnthropicChat(cred.data.apiKey, input.model || 'claude-sonnet-4-6', input);
      } else if (cred?.slug === 'openai' && cred.data.apiKey) {
        // OpenAI: v1 sin tool-calling — una respuesta directa (el agente termina en un paso)
        const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
        const gen = await callOpenAI(cred.data.apiKey, input.model || 'gpt-4o-mini', {
          prompt: lastUser?.content ?? '',
          system: input.system,
          maxTokens: input.maxTokens,
        });
        result = {
          text: gen.text,
          toolCalls: [],
          stopReason: 'end_turn',
          provider: gen.provider,
          model: gen.model,
          inputTokens: gen.inputTokens,
          outputTokens: gen.outputTokens,
        };
      } else {
        result = devEchoChat(input);
      }
      await record({
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      return result;
    },
  };
}

/**
 * Construye los servicios para una ejecución. `nodeIdRef` lo actualiza el
 * worker en cada paso para atribuir el uso de IA al nodo correcto.
 */
function makeWhatsAppService(ctx: ServiceContext): NodeServices['whatsapp'] {
  const resolveCredential = makeCredentialResolver(ctx);
  return {
    async sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult> {
      const cred = input.credentialId ? await resolveCredential(input.credentialId) : null;
      if (cred?.slug === 'whatsapp-cloud' && cred.data.accessToken && cred.data.phoneNumberId) {
        const { messageId } = await sendWhatsAppText({
          accessToken: cred.data.accessToken,
          phoneNumberId: cred.data.phoneNumberId,
          to: input.to,
          text: input.text,
        });
        return { to: input.to, text: input.text, sent: true, simulated: false, messageId };
      }
      // Sin credencial: simulado (el simulador muestra el texto igual)
      return { to: input.to, text: input.text, sent: false, simulated: true };
    },
  };
}

/* ── Memoria de conversación (persistida en la DB) ──────────── */

const ROLE_LABEL: Record<string, string> = { user: 'Cliente', assistant: 'Bot', system: 'Sistema', operator: 'Coordinador' };

function formatTranscript(turns: ConversationTurn[]): string {
  return turns.map((t) => `${ROLE_LABEL[t.role] ?? t.role}: ${t.text}`).join('\n');
}

function makeMemoryService(ctx: ServiceContext): NodeServices['memory'] {
  const findOrCreate = (channel: string, contact: string) =>
    ctx.prisma.conversation.upsert({
      where: { projectId_channel_contact: { projectId: ctx.projectId, channel, contact } },
      create: { projectId: ctx.projectId, channel, contact },
      update: {},
    });

  return {
    async loadHistory(input: MemoryLoadInput): Promise<MemoryLoadResult> {
      const conversation = await findOrCreate(input.channel, input.contact);
      const rows = await ctx.prisma.conversationMessage.findMany({
        where: { conversationId: conversation.id },
        orderBy: { createdAt: 'desc' },
        take: input.limit ?? 10,
      });
      const turns: ConversationTurn[] = rows
        .reverse()
        .map((row) => ({ role: row.role as ConversationRole, text: row.text }));
      return {
        conversationId: conversation.id,
        turns,
        transcript: formatTranscript(turns),
        status: conversation.status,
      };
    },

    async saveTurn(input: MemorySaveInput): Promise<MemorySaveResult> {
      const conversation = await findOrCreate(input.channel, input.contact);
      await ctx.prisma.conversationMessage.create({
        data: { conversationId: conversation.id, role: input.role, text: input.text },
      });
      await ctx.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: new Date() },
      });
      return { conversationId: conversation.id };
    },

    async setStatus(input: MemorySetStatusInput): Promise<{ conversationId: string }> {
      const conversation = await findOrCreate(input.channel, input.contact);
      await ctx.prisma.conversation.update({
        where: { id: conversation.id },
        data: { status: input.status },
      });
      return { conversationId: conversation.id };
    },
  };
}

/* ── Email (SMTP con nodemailer) ────────────────────────────── */

function makeEmailService(ctx: ServiceContext): NodeServices['email'] {
  const resolveCredential = makeCredentialResolver(ctx);
  return {
    async send(input: EmailSendInput): Promise<EmailSendResult> {
      const cred = input.credentialId ? await resolveCredential(input.credentialId) : null;
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
      // Sin credencial: simulado (no rompe el flujo al probar)
      return { to: input.to, subject: input.subject, sent: false, simulated: true };
    },
  };
}

/* ── Contactos / CRM (persistido en la DB) ──────────────────── */

interface ContactRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  tags: string[];
  notes: string | null;
  data: unknown;
}

function toContactRecord(row: ContactRow): ContactRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    tags: row.tags,
    notes: row.notes,
    data: (row.data as Record<string, unknown> | null) ?? null,
  };
}

function makeContactService(ctx: ServiceContext): NodeServices['contacts'] {
  const findRow = async (identity: ContactIdentity): Promise<ContactRow | null> => {
    if (identity.phone) {
      const byPhone = await ctx.prisma.contact.findFirst({ where: { projectId: ctx.projectId, phone: identity.phone } });
      if (byPhone) return byPhone;
    }
    if (identity.email) {
      return ctx.prisma.contact.findFirst({ where: { projectId: ctx.projectId, email: identity.email } });
    }
    return null;
  };

  return {
    async find(identity: ContactIdentity): Promise<ContactRecord | null> {
      const row = await findRow(identity);
      return row ? toContactRecord(row) : null;
    },

    async upsert(input: ContactUpsertInput): Promise<ContactRecord> {
      const existing = await findRow(input);
      const contacted = input.markContacted ? { lastContactedAt: new Date() } : {};
      if (existing) {
        const mergedTags = input.tags
          ? Array.from(new Set([...existing.tags, ...input.tags]))
          : undefined;
        const mergedData = input.data
          ? ({ ...((existing.data as Record<string, unknown> | null) ?? {}), ...input.data } as Prisma.InputJsonValue)
          : undefined;
        const updated = await ctx.prisma.contact.update({
          where: { id: existing.id },
          data: {
            name: input.name ?? undefined,
            phone: input.phone ?? undefined,
            email: input.email ?? undefined,
            status: input.status ?? undefined,
            tags: mergedTags,
            notes: input.notes ?? undefined,
            data: mergedData,
            ...contacted,
          },
        });
        return toContactRecord(updated);
      }
      const created = await ctx.prisma.contact.create({
        data: {
          projectId: ctx.projectId,
          name: input.name,
          phone: input.phone,
          email: input.email,
          status: input.status ?? 'new',
          tags: input.tags ?? [],
          notes: input.notes,
          data: (input.data as Prisma.InputJsonValue | undefined) ?? undefined,
          ...contacted,
        },
      });
      return toContactRecord(created);
    },
  };
}

/* ── Base de conocimiento (RAG v1, keyword sobre la DB) ─────── */

function makeKnowledgeService(ctx: ServiceContext): NodeServices['knowledge'] {
  return {
    async search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult> {
      const rows = await ctx.prisma.knowledgeChunk.findMany({
        where: { projectId: ctx.projectId },
        select: { id: true, title: true, content: true },
        take: 1000,
      });
      return rankKnowledge(rows, input.query, input.limit ?? 3);
    },
  };
}

export function buildServices(ctx: ServiceContext, nodeIdRef: { current: string }): NodeServices {
  return {
    http: makeHttpService(ctx),
    ai: makeAIService(ctx, nodeIdRef),
    whatsapp: makeWhatsAppService(ctx),
    memory: makeMemoryService(ctx),
    email: makeEmailService(ctx),
    contacts: makeContactService(ctx),
    knowledge: makeKnowledgeService(ctx),
  };
}
