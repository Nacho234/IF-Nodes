import type { EmailIncomingMessage } from '../nodes/trigger/email-trigger';

/**
 * Normaliza un mail entrante al formato interno, venga del transporte que venga
 * (Gmail, IMAP, o un proveedor con webhook de entrada tipo Postmark/SendGrid/Mailgun).
 * Pura y testeable; la usa el runtime exportado en POST /webhooks/email.
 */

/** "Juan Pérez <juan@agencia.com>" → { name: 'Juan Pérez', address: 'juan@agencia.com' } */
export function parseAddress(raw: string): { name: string; address: string } {
  const s = (raw ?? '').trim();
  const angle = s.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    return {
      name: (angle[1] ?? '').trim().replace(/^["']|["']$/g, '').trim(),
      address: (angle[2] ?? '').trim().toLowerCase(),
    };
  }
  return { name: '', address: s.toLowerCase() };
}

/**
 * Saca la cita del mensaje anterior y la firma. Sin esto el bot recibe el hilo
 * entero pegado en cada respuesta y no distingue lo nuevo de lo viejo.
 */
export function stripQuotedReply(body: string): string {
  const lines = (body ?? '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];

  // Encabezados de cita, en los idiomas que usan los coordinadores + clientes de mail comunes.
  const quoteHeader =
    /^\s*(>|-{2,}\s*(Original Message|Mensaje original|Forwarded message)|_{5,}|En\s.+escribi[oó]:|El\s.+escribi[oó]:|On\s.+wrote:|Em\s.+escreveu:|De:\s|From:\s.+@)/i;

  for (const line of lines) {
    if (quoteHeader.test(line)) break;
    // Firma estándar: una línea exactamente "-- "
    if (/^--\s?$/.test(line)) break;
    out.push(line);
  }

  return out.join('\n').trim();
}

/** Convierte HTML a texto plano cuando el mail no trae parte de texto. */
export function htmlToText(html: string): string {
  return (html ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Acepta las formas de los transportes más comunes y devuelve el mensaje normalizado,
 * o null si el payload no tiene remitente (no hay hilo posible sin eso).
 *
 * Formas soportadas:
 *  - Normalizada / Gmail relay: { from, subject, text, html, messageId, inReplyTo }
 *  - Postmark:  { From, FromFull:{Email,Name}, Subject, TextBody, HtmlBody, MessageID }
 *  - SendGrid Inbound Parse: { from, subject, text, html, headers }
 *  - Mailgun routes: { sender, from, subject, 'body-plain', 'stripped-text', 'body-html' }
 */
export function parseInboundEmail(payload: unknown): EmailIncomingMessage | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Raw;

  const fromRaw =
    str(p.from) ||
    str(p.From) ||
    str(p.sender) ||
    str((p.FromFull as Raw | undefined)?.Email) ||
    '';
  if (!fromRaw) return null;

  const parsed = parseAddress(fromRaw);
  if (!parsed.address.includes('@')) return null;

  // Mailgun ya manda el cuerpo sin la cita: si está, le creemos.
  const stripped = str(p['stripped-text']);
  const plain = stripped || str(p.text) || str(p.TextBody) || str(p['body-plain']);
  const html = str(p.html) || str(p.HtmlBody) || str(p['body-html']);
  const body = plain || htmlToText(html);

  const headers = (p.headers as Raw | undefined) ?? {};

  return {
    text: stripped ? body.trim() : stripQuotedReply(body),
    subject: str(p.subject) || str(p.Subject) || '',
    from: parsed.address,
    name:
      parsed.name ||
      str((p.FromFull as Raw | undefined)?.Name) ||
      (parsed.address.split('@')[0] ?? parsed.address),
    messageId: str(p.messageId) || str(p.MessageID) || str(headers['Message-Id']) || str(p['Message-Id']),
    inReplyTo: str(p.inReplyTo) || str(headers['In-Reply-To']) || str(p['In-Reply-To']),
    channel: 'email',
    receivedAt: new Date().toISOString(),
  };
}
