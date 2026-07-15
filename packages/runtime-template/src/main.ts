/**
 * Punto de entrada del runtime exportado. Lee workflow/ del disco (uno o varios
 * flujos), valida el entorno y levanta un servidor HTTP nativo (sin frameworks).
 * Orquesta el proyecto completo: entrada (WhatsApp/webhook) → flujo inbound,
 * POST /campaigns/run → fan-out por contacto, y un scheduler cron para los
 * flujos "Programado". Escucha en process.env.PORT (Railway) con fallback 3000.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWhatsAppWebhook, parseInboundEmail } from '@ifnodes/node-definitions';
import {
  loadProject,
  runProjectFlow,
  replyFromResult,
  inboundFlow,
  whatsappFlow,
  emailFlow,
  campaignFlows,
  scheduleFlows,
  scheduleConfig,
  flowBySlug,
  type RuntimeManifest,
  type FlowBundle,
  type LoadedProject,
} from './runtime';
import type { CredentialManifest } from './services';
import { createRuntimeStore, type ContactSeed, type ConversationSeed } from './store';
import { runCampaign } from './campaigns';
import { CronScheduler } from './cron';
import { checkApiKey, checkWhatsAppSignature, checkEmailWebhookToken, RateLimiter } from './security';
import { ImapPoller, imapConfigFromEnv } from './imap';

/** Campos aceptados por POST /campaigns/run (el filtro va plano, ver README). */
const CAMPAIGN_BODY_KEYS = new Set([
  'flow',
  'status',
  'tags',
  'hasPhone',
  'hasEmail',
  'limit',
  'staggerMs',
  'dryRun',
]);

const WORKFLOW_DIR = resolve(process.cwd(), 'workflow');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(resolve(WORKFLOW_DIR, file), 'utf8')) as T;
}
function tryReadJson<T>(file: string, fallback: T): T {
  try {
    return readJson<T>(file);
  } catch {
    return fallback;
  }
}

function log(level: 'info' | 'warn' | 'error', message: string, extra: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level, message, ts: new Date().toISOString(), ...extra }));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * Lee el cuerpo devolviendo TAMBIÉN los bytes crudos: la firma de Meta es un HMAC
 * sobre el cuerpo exacto, así que re-serializar el JSON parseado la invalida.
 */
async function readBody(req: IncomingMessage): Promise<{ raw: Buffer; json: unknown }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 1_000_000) throw new Error('Payload demasiado grande');
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks);
  if (raw.length === 0) return { raw, json: {} };
  const text = raw.toString('utf8');
  try {
    return { raw, json: JSON.parse(text) };
  } catch {
    return { raw, json: { body: text } };
  }
}

/** Lee los flujos: flows.json (proyecto multi-flow) o workflow.json (legacy 1 flujo). */
function loadFlowBundles(): FlowBundle[] {
  const flows = tryReadJson<FlowBundle[] | null>('flows.json', null);
  if (Array.isArray(flows) && flows.length > 0) return flows;
  const single = readJson<unknown>('workflow.json');
  return [{ id: 'exported', name: 'Flujo principal', slug: 'principal', graph: single }];
}

async function main(): Promise<void> {
  const manifest = readJson<RuntimeManifest>('manifest.json');
  const bundles = loadFlowBundles();
  const credentials = tryReadJson<CredentialManifest>('credentials.json', {});
  const knowledge = tryReadJson<{ id: string; title: string | null; content: string }[]>('knowledge.json', []);
  const contactSeed = tryReadJson<ContactSeed[]>('contacts.json', []);
  const historySeed = tryReadJson<ConversationSeed[]>('conversations.json', []);

  const missing = manifest.requiredEnvironmentVariables.filter((name) => !process.env[name]);
  if (missing.length > 0) log('warn', 'Faltan variables de entorno requeridas', { missing });

  // Persistencia: Postgres/Supabase si hay URL (producción), si no en memoria (efímero)
  const store = createRuntimeStore();
  if (store.init) {
    await store.init();
    log('info', 'Persistencia: base de datos conectada (memoria y contactos persistentes)');
  } else {
    log('info', 'Persistencia: en memoria del proceso (efímera). Definí DATABASE_URL para persistir.');
  }

  if (contactSeed.length > 0) {
    const { seeded, skipped } = await store.seedContacts(contactSeed);
    if (skipped) log('info', 'CRM ya poblado: se omite la carga inicial de contactos', { disponibles: contactSeed.length });
    else log('info', 'CRM sembrado con la carga inicial de contactos', { seeded, disponibles: contactSeed.length });
  }

  if (historySeed.length > 0) {
    const { seeded, turns, skipped } = await store.seedConversations(historySeed);
    if (skipped) log('info', 'Ya hay conversaciones: se omite la carga inicial del historial', { disponibles: historySeed.length });
    else log('info', 'Historial sembrado: el bot arranca recordando las charlas previas', { hilos: seeded, turnos: turns });
  }

  const project: LoadedProject = loadProject(bundles, manifest, credentials, knowledge, store);
  const inbound = inboundFlow(project);
  const wa = whatsappFlow(project);
  const mail = emailFlow(project);

  // Un runtime abierto en silencio es peor que uno que grita: si falta una defensa, se avisa.
  if (!process.env.RUNTIME_API_KEY) {
    log('warn', '⚠ SIN RUNTIME_API_KEY: /conversations/*, /campaigns/run y /run quedan ABIERTOS a cualquiera que conozca la URL. Definila ya.');
  }
  if (wa && !process.env.WHATSAPP_APP_SECRET) {
    log('warn', '⚠ SIN WHATSAPP_APP_SECRET: no se verifica la firma de Meta, cualquiera puede fingir un mensaje entrante.');
  }
  if (mail && !process.env.EMAIL_WEBHOOK_TOKEN) {
    log('warn', '⚠ SIN EMAIL_WEBHOOK_TOKEN: /webhooks/email acepta mails de cualquiera. (No aplica si solo entrás por IMAP.)');
  }

  log('info', 'Proyecto cargado', {
    project: manifest.project,
    flows: project.flows.map((f) => ({ slug: f.slug, trigger: f.triggerType })),
    inbound: inbound?.slug ?? null,
  });

  // Scheduler: registra un job cron por cada flujo "Programado"
  const rateLimiter = new RateLimiter();
  const scheduler = new CronScheduler();
  for (const flow of scheduleFlows(project)) {
    const cfg = scheduleConfig(flow);
    if (!cfg) continue;
    const ok = scheduler.add({
      id: flow.id,
      cron: cfg.cron,
      timezone: cfg.timezone,
      run: async (firedAt) => {
        const started = Date.now();
        const result = await runProjectFlow(project, flow, { firedAt: firedAt.toISOString(), cron: cfg.cron });
        log('info', 'Flujo programado disparado', { flow: flow.slug, status: result.status, ms: Date.now() - started });
      },
    });
    log(ok ? 'info' : 'warn', ok ? 'Cron registrado' : 'Cron inválido, se ignora', { flow: flow.slug, cron: cfg.cron });
  }
  scheduler.start();

  // Mail entrante por IMAP: si hay casilla configurada, el bot va a buscar los mails.
  // Sin IMAP_HOST el bot igual anda: recibe por /webhooks/email o no recibe mail.
  const imapCfg = imapConfigFromEnv();
  if (imapCfg && mail) {
    new ImapPoller(
      imapCfg,
      async (message) => {
        const started = Date.now();
        const result = await runProjectFlow(project, mail, message as unknown as Record<string, unknown>);
        log('info', 'Mail procesado', { from: message.from, status: result.status, ms: Date.now() - started });
      },
      log,
    ).start();
  } else if (imapCfg && !mail) {
    log('warn', 'Hay casilla IMAP configurada pero ningún flujo con disparador "Mail recibido": los mails no se van a atender.');
  } else if (mail) {
    log('info', 'Flujo de mail listo, sin casilla IMAP: definí IMAP_HOST/IMAP_USER/IMAP_PASSWORD para recibir, o posteá a /webhooks/email.');
  }


  const server = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      log('error', 'Error no controlado', { error: error instanceof Error ? error.message : String(error) });
      send(res, 500, { error: 'internal_error' });
    });
  });

  /** Endpoints que exponen o mueven datos: exigen RUNTIME_API_KEY. */
  const PROTEGIDOS = ['/conversations/reply', '/conversations/history', '/campaigns/run', '/run', '/flows'];

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    // Freno por IP: un bucle o un script no puede disparar miles de ejecuciones (y de llamadas a la IA).
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.socket.remoteAddress || 'desconocida';
    if (!path.startsWith('/health') && rateLimiter.limited(ip)) {
      return send(res, 429, { error: 'rate_limited' });
    }

    // Operación: sin la API key no se lee ni se manda nada.
    if (PROTEGIDOS.some((p) => path === p || path.startsWith(p + '/'))) {
      const motivo = checkApiKey(req.headers);
      if (motivo) {
        log('warn', 'Request rechazado', { path, motivo, ip });
        return send(res, 401, { error: 'unauthorized', message: 'Requiere el header Authorization: Bearer <RUNTIME_API_KEY>.' });
      }
    }

    // Health checks
    if (path === '/health' && method === 'GET') {
      return send(res, 200, { status: 'ok', project: manifest.project, version: manifest.workflowVersion, flows: project.flows.length });
    }
    if (path === '/health/live' && method === 'GET') return send(res, 200, { status: 'ok' });
    if (path === '/health/ready' && method === 'GET') {
      return missing.length > 0
        ? send(res, 503, { status: 'not_ready', missingEnv: missing })
        : send(res, 200, { status: 'ready' });
    }

    // Visibilidad para operadores: lista de flujos y sus triggers
    if (path === '/flows' && method === 'GET') {
      return send(res, 200, {
        flows: project.flows.map((f) => ({ id: f.id, name: f.name, slug: f.slug, trigger: f.triggerType })),
        scheduledJobs: scheduler.size,
      });
    }

    // Verificación de webhook de WhatsApp (Meta)
    if (path === '/webhooks/whatsapp' && method === 'GET' && wa) {
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

    // Webhook de WhatsApp: parsear el payload de Meta y ejecutar el flujo inbound
    if (path === '/webhooks/whatsapp' && method === 'POST' && wa) {
      let payload: unknown;
      let raw: Buffer;
      try {
        ({ json: payload, raw } = await readBody(req));
      } catch {
        return send(res, 413, { error: 'payload_too_large' });
      }
      // Meta firma cada webhook con el App Secret. Sin verificarlo, cualquiera
      // postea un mensaje inventado y el bot lo procesa como real.
      const malaFirma = checkWhatsAppSignature(req.headers['x-hub-signature-256'], raw);
      if (malaFirma) {
        log('warn', 'Webhook de WhatsApp rechazado', { motivo: malaFirma });
        return send(res, 401, { error: 'invalid_signature' });
      }
      const messages = parseWhatsAppWebhook(payload);
      for (const message of messages) {
        const started = Date.now();
        const result = await runProjectFlow(project, wa, message as unknown as Record<string, unknown>);
        log('info', 'Mensaje de WhatsApp procesado', { from: message.phone, status: result.status, ms: Date.now() - started });
      }
      return send(res, 200, { status: 'ok', processed: messages.length });
    }

    // Mail entrante: cualquier transporte (Gmail, IMAP, proveedor) postea el mail crudo acá.
    if (path === '/webhooks/email' && method === 'POST' && mail) {
      // El proveedor de mail no puede mandar nuestra API key: el token va en la URL.
      const malToken = checkEmailWebhookToken(url);
      if (malToken) {
        log('warn', 'Webhook de mail rechazado', { motivo: malToken });
        return send(res, 401, { error: 'invalid_token' });
      }
      let payload: unknown;
      try {
        payload = (await readBody(req)).json;
      } catch {
        return send(res, 413, { error: 'payload_too_large' });
      }
      const message = parseInboundEmail(payload);
      if (!message) return send(res, 400, { error: 'unparseable_email', message: 'Sin remitente válido no hay hilo posible.' });
      const started = Date.now();
      const result = await runProjectFlow(project, mail, message as unknown as Record<string, unknown>);
      log('info', 'Mail procesado', { from: message.from, status: result.status, ms: Date.now() - started });
      return send(res, 200, { status: 'ok', from: message.from });
    }

    // El operador toma el mando: manda un mensaje escrito por una persona y lo deja
    // en el mismo historial que usa el bot. Sin esto, el handoff obliga al coordinador
    // a contestar desde su celular y el bot pierde el contexto de lo que se habló.
    if (path === '/conversations/reply' && method === 'POST') {
      let body: Record<string, unknown> = {};
      try {
        const { json } = await readBody(req);
        if (json && typeof json === 'object') body = json as Record<string, unknown>;
      } catch {
        return send(res, 413, { error: 'payload_too_large' });
      }
      const channel = String(body.channel ?? '');
      const contact = String(body.contact ?? '');
      const text = String(body.text ?? '');
      if (!contact || !text || (channel !== 'whatsapp' && channel !== 'email')) {
        return send(res, 400, {
          error: 'invalid_reply',
          message: 'Requiere channel ("whatsapp" | "email"), contact y text.',
        });
      }

      const services = project.services;
      let simulated: boolean | undefined;
      if (channel === 'whatsapp') {
        if (!services.whatsapp) return send(res, 503, { error: 'whatsapp_unavailable' });
        simulated = (await services.whatsapp.sendText({ to: contact, text })).simulated;
      } else {
        if (!services.email) return send(res, 503, { error: 'email_unavailable' });
        simulated = (await services.email.send({ to: contact, subject: String(body.subject ?? 'FePI'), text })).simulated;
      }

      // El turno queda como "operator": el bot lo lee como lado propio y no se contradice.
      await services.memory?.saveTurn({ channel, contact, role: 'operator', text });

      // Por defecto el humano se queda con la conversación. status:"open" se la devuelve al bot.
      const status = body.status === 'open' || body.status === 'closed' ? String(body.status) : 'handoff';
      await services.memory?.setStatus({ channel, contact, status });

      log('info', 'Respuesta del operador enviada', { channel, contact, status, simulated });
      return send(res, 200, { status: 'ok', channel, contact, conversationStatus: status, simulated });
    }

    // Historial de una conversación, para que el panel la muestre.
    if (path === '/conversations/history' && method === 'GET') {
      const channel = url.searchParams.get('channel') ?? '';
      const contact = url.searchParams.get('contact') ?? '';
      if (!contact || !channel) return send(res, 400, { error: 'invalid_query', message: 'Requiere ?channel= y ?contact=' });
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 200);
      const r = await project.services.memory?.loadHistory({ channel, contact, limit });
      return send(res, 200, { channel, contact, status: r?.status ?? 'open', turns: r?.turns ?? [] });
    }

    // Lanzador de campañas: fan-out por contacto sobre el flujo de campaña
    if (path === '/campaigns/run' && method === 'POST') {
      const flows = campaignFlows(project);
      if (flows.length === 0) return send(res, 404, { error: 'no_campaign_flow' });
      let body: Record<string, unknown> = {};
      try {
        const { json } = await readBody(req);
        if (json && typeof json === 'object') body = json as Record<string, unknown>;
      } catch {
        return send(res, 413, { error: 'payload_too_large' });
      }
      // Una clave desconocida (typo, o filtro anidado) NO puede degradar a
      // "sin filtro": eso le escribiría a TODOS los contactos. Mejor 400.
      const unknown = Object.keys(body).filter((k) => !CAMPAIGN_BODY_KEYS.has(k));
      if (unknown.length > 0) {
        return send(res, 400, {
          error: 'unknown_fields',
          message: `Campos no reconocidos: ${unknown.join(', ')}. El filtro va plano en el cuerpo.`,
          allowed: [...CAMPAIGN_BODY_KEYS],
        });
      }
      const flow = typeof body.flow === 'string' ? flowBySlug(project, body.flow) : flows[0];
      if (!flow) return send(res, 404, { error: 'flow_not_found' });
      const result = await runCampaign(project, flow, store, {
        status: typeof body.status === 'string' ? body.status : undefined,
        tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
        hasPhone: body.hasPhone === true,
        hasEmail: body.hasEmail === true,
        limit: typeof body.limit === 'number' ? body.limit : undefined,
        staggerMs: typeof body.staggerMs === 'number' ? body.staggerMs : undefined,
        dryRun: body.dryRun === true,
      });
      log('info', 'Campaña ejecutada', { flow: flow.slug, ...result });
      return send(res, 200, { status: 'ok', flow: flow.slug, ...result });
    }

    // Ejecución genérica: POST /run (opcional ?flow=slug) y /webhooks/*
    if ((path === '/run' || path.startsWith('/webhooks/')) && method === 'POST') {
      const slug = url.searchParams.get('flow');
      const flow = slug ? flowBySlug(project, slug) : inbound;
      if (!flow) return send(res, 404, { error: slug ? 'flow_not_found' : 'no_inbound_flow' });
      let input: Record<string, unknown>;
      try {
        const { json } = await readBody(req);
        input = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : { body: json };
      } catch {
        return send(res, 413, { error: 'payload_too_large' });
      }
      const started = Date.now();
      const result = await runProjectFlow(project, flow, input);
      log('info', 'Ejecución finalizada', { flow: flow.slug, status: result.status, ms: Date.now() - started });
      if (result.status === 'SUCCEEDED') return send(res, 200, { status: 'ok', reply: replyFromResult(result) });
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
    scheduler.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error) => {
  log('error', 'No se pudo iniciar el runtime', { error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
});
