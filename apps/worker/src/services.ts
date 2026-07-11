/**
 * Implementación de los servicios que el motor inyecta en los nodos
 * (context.services): HTTP con guarda SSRF e IA con capa de proveedores.
 * Se construyen por ejecución para poder atribuir uso/credenciales al contexto.
 */
import { lookup } from 'node:dns/promises';
import type { PrismaClient } from '@ifnodes/database';
import { checkSsrf, ssrfPolicyFromEnv } from '@ifnodes/shared';
import { decryptSecret } from '@ifnodes/shared/dist/crypto';
import type {
  AIClassifyInput,
  AIClassifyResult,
  AIGenerateInput,
  AIGenerateResult,
  HttpRequestInput,
  HttpResult,
  NodeServices,
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
        result = await callAnthropic(cred.data.apiKey, input.model || 'claude-sonnet-4-5', input);
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
            ? await callAnthropic(cred.data.apiKey, input.model || 'claude-sonnet-4-5', { prompt, maxTokens: 20 })
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
  };
}

/**
 * Construye los servicios para una ejecución. `nodeIdRef` lo actualiza el
 * worker en cada paso para atribuir el uso de IA al nodo correcto.
 */
export function buildServices(ctx: ServiceContext, nodeIdRef: { current: string }): NodeServices {
  return {
    http: makeHttpService(ctx),
    ai: makeAIService(ctx, nodeIdRef),
  };
}
