/**
 * Punto de entrada del runtime exportado. Lee workflow/ del disco, valida el
 * entorno y levanta un servidor HTTP nativo (sin dependencias de framework).
 * Escucha en process.env.PORT (Railway) con fallback 3000.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadRuntime, runFlow, replyFromResult, type RuntimeManifest } from './runtime';
import type { CredentialManifest } from './services';

const WORKFLOW_DIR = resolve(process.cwd(), 'workflow');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(WORKFLOW_DIR, file), 'utf8')) as T;
}

function log(level: 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, message, ts: new Date().toISOString(), ...extra }));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('Payload demasiado grande');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return { body: text };
  }
}

function main(): void {
  const manifest = readJson<RuntimeManifest>('manifest.json');
  const workflow = readJson<unknown>('workflow.json');
  let credentials: CredentialManifest = {};
  try {
    credentials = readJson<CredentialManifest>('credentials.json');
  } catch {
    credentials = {};
  }

  // Falla rápido si falta alguna variable de entorno requerida
  const missing = manifest.requiredEnvironmentVariables.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    log('warn', 'Faltan variables de entorno requeridas', { missing });
  }

  const loaded = loadRuntime(workflow, manifest, credentials);
  log('info', 'Workflow cargado y validado', {
    project: manifest.project,
    version: manifest.workflowVersion,
    nodes: loaded.graph.nodes.length,
  });

  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      log('error', 'Error no controlado', { error: error instanceof Error ? error.message : String(error) });
      send(res, 500, { error: 'internal_error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Health checks
    if (path === '/health' && method === 'GET') {
      return send(res, 200, { status: 'ok', project: manifest.project, version: manifest.workflowVersion });
    }
    if (path === '/health/live' && method === 'GET') return send(res, 200, { status: 'ok' });
    if (path === '/health/ready' && method === 'GET') {
      return missing.length > 0
        ? send(res, 503, { status: 'not_ready', missingEnv: missing })
        : send(res, 200, { status: 'ready' });
    }

    // Verificación de webhook de WhatsApp (Meta)
    if (path === '/webhooks/whatsapp' && method === 'GET' && loaded.hasWhatsAppTrigger) {
      const mode = url.searchParams.get('hub.mode');
      const token = url.searchParams.get('hub.verify_token');
      const challenge = url.searchParams.get('hub.challenge');
      if (mode === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(challenge ?? '');
        return;
      }
      return send(res, 403, { error: 'verify_failed' });
    }

    // Ejecución del flujo: POST /run (entrada = body como trigger) y /webhooks/*
    if ((path === '/run' || path.startsWith('/webhooks/')) && method === 'POST') {
      let input: Record<string, unknown>;
      try {
        const body = await readBody(req);
        input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : { body };
      } catch {
        return send(res, 413, { error: 'payload_too_large' });
      }
      const started = Date.now();
      const result = await runFlow(loaded, input);
      log('info', 'Ejecución finalizada', { status: result.status, ms: Date.now() - started });
      if (result.status === 'SUCCEEDED') {
        return send(res, 200, { status: 'ok', reply: replyFromResult(result) });
      }
      return send(res, 200, {
        status: result.status.toLowerCase(),
        error: result.error ? { code: result.error.code, message: result.error.message } : undefined,
      });
    }

    send(res, 404, { error: 'not_found' });
  }

  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, () => log('info', `Runtime escuchando en :${port}`, { entrypoints: manifest.entrypoints }));

  const shutdown = () => {
    log('info', 'Apagando runtime…');
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
