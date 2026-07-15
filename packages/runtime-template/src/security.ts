/**
 * Seguridad del runtime expuesto a internet.
 *
 * El bot queda con una URL pública: sin esto, cualquiera que la conozca puede leer
 * las conversaciones de todos los contactos, mandar mensajes haciéndose pasar por
 * el equipo, o disparar una campaña a la base entera.
 *
 * Dos superficies distintas, dos defensas distintas:
 *  - Endpoints de operación (/conversations/*, /campaigns/run, /run, /flows) → RUNTIME_API_KEY.
 *  - Webhooks, que los llama un tercero y no pueden llevar nuestra key → firma del proveedor
 *    (Meta) o un token en la URL (mail).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compara sin filtrar por tiempo cuántos caracteres coinciden. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a ?? '', 'utf8');
  const bb = Buffer.from(b ?? '', 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Valida la API key de operación. Devuelve el motivo del rechazo, o null si pasa.
 * Sin RUNTIME_API_KEY definida el runtime queda ABIERTO: se avisa fuerte al arrancar.
 */
export function checkApiKey(headers: Record<string, string | string[] | undefined>, env = process.env): string | null {
  const expected = env.RUNTIME_API_KEY;
  if (!expected) return null; // sin key configurada no se puede exigir; el arranque lo advierte

  const raw = headers['authorization'] ?? headers['x-api-key'];
  const got = Array.isArray(raw) ? raw[0] ?? '' : raw ?? '';
  const token = got.startsWith('Bearer ') ? got.slice(7) : got;
  if (!token) return 'falta_api_key';
  return safeEqual(token, expected) ? null : 'api_key_invalida';
}

/**
 * Verifica la firma que Meta manda en cada webhook (X-Hub-Signature-256 = HMAC-SHA256
 * del cuerpo crudo con el App Secret). Sin esto cualquiera finge un mensaje entrante.
 * Requiere el cuerpo TAL CUAL llegó: si se parsea y re-serializa, la firma no da.
 */
export function checkWhatsAppSignature(
  header: string | string[] | undefined,
  rawBody: Buffer,
  env = process.env,
): string | null {
  const secret = env.WHATSAPP_APP_SECRET;
  if (!secret) return null; // sin app secret no se puede verificar; el arranque lo advierte

  const got = Array.isArray(header) ? header[0] ?? '' : header ?? '';
  if (!got.startsWith('sha256=')) return 'firma_ausente';

  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqual(got, expected) ? null : 'firma_invalida';
}

/** Token del webhook de mail: va en la URL porque el proveedor no manda headers nuestros. */
export function checkEmailWebhookToken(url: URL, env = process.env): string | null {
  const expected = env.EMAIL_WEBHOOK_TOKEN;
  if (!expected) return null;
  const got = url.searchParams.get('token') ?? '';
  return got && safeEqual(got, expected) ? null : 'token_invalido';
}

/**
 * Limitador por IP, ventana deslizante en memoria. No reemplaza a un WAF, pero
 * evita que un bucle o un script tonto haga miles de ejecuciones (y de llamadas a la IA).
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly max = Number(process.env.RATE_LIMIT_MAX ?? 120),
    private readonly windowMs = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  ) {}

  /** true si hay que rechazar. */
  limited(key: string): boolean {
    const now = Date.now();
    const recientes = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    recientes.push(now);
    this.hits.set(key, recientes);
    if (this.hits.size > 10_000) this.hits.clear(); // techo de memoria: no acumular IPs para siempre
    return recientes.length > this.max;
  }
}
