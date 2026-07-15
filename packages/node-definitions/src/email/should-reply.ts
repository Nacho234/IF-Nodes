/**
 * Decide si un mail entrante merece que el bot conteste.
 *
 * Sin esto el bot le responde a TODO lo que caiga en la bandeja: un "estoy de
 * vacaciones" desata un bucle infinito (el bot contesta, el auto-responder
 * contesta, el bot contesta...) quemando créditos de IA; y a los rebotes,
 * newsletters y spam les abre un hilo de conversación como si fueran agencias.
 */

export interface InboundHeaders {
  /** Headers del mail, en minúsculas. */
  [key: string]: string | undefined;
}

export interface ReplyDecision {
  reply: boolean;
  /** Por qué no, para el log. */
  reason?: string;
}

/** Remitentes que nunca son una persona esperando respuesta. */
const REMITENTES_AUTOMATICOS =
  /^(mailer-daemon|postmaster|no-?reply|noreply|do-?not-?reply|bounce|bounces|notifications?|automated|donotreply|newsletter|news|info-?bot)@/i;

/**
 * Asuntos típicos de rebote o respuesta automática.
 * Ojo con el orden de las palabras: en inglés es "Automatic reply" pero en español
 * es "Respuesta automática" y en portugués "Resposta automática" — al revés.
 * Los prefijos "Re:"/"RE:" que agregan los clientes de mail también hay que saltarlos.
 */
const ASUNTOS_AUTOMATICOS =
  /^\s*((re|rv|fwd?)\s*:\s*)*(auto(matic|mática|mática)?[\s-]?(reply|respuesta|resposta)|(respuesta|resposta)[\s-]?autom[aá]tic[ao]|out of office|fuera de (la )?oficina|ausencia|undeliverable|undelivered|delivery (status notification|failure)|returned mail|mail delivery (failed|subsystem)|correo no entregado|vacation|abwesenheit)/i;

/**
 * `true` si hay que contestar. Se apoya en los headers estándar que los
 * auto-responders y los servidores de rebote están obligados a poner:
 * RFC 3834 (Auto-Submitted) y la convención Precedence: bulk/list/junk.
 */
export function shouldReplyToEmail(input: {
  from: string;
  subject?: string;
  headers?: InboundHeaders;
}): ReplyDecision {
  const from = (input.from ?? '').toLowerCase().trim();
  const subject = input.subject ?? '';
  const h = input.headers ?? {};

  if (!from || !from.includes('@')) return { reply: false, reason: 'sin_remitente' };

  // RFC 3834: todo auto-responder decente marca su mail así.
  const autoSubmitted = (h['auto-submitted'] ?? '').toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return { reply: false, reason: 'auto-submitted' };

  // Microsoft/Exchange
  if ((h['x-auto-response-suppress'] ?? '').length > 0) return { reply: false, reason: 'x-auto-response-suppress' };
  if ((h['x-autoreply'] ?? h['x-autorespond'] ?? '').length > 0) return { reply: false, reason: 'x-autoreply' };

  // Listas de correo y envíos masivos
  const precedence = (h['precedence'] ?? '').toLowerCase();
  if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) return { reply: false, reason: `precedence:${precedence}` };
  if (h['list-unsubscribe'] || h['list-id']) return { reply: false, reason: 'lista_de_correo' };

  // Rebotes: Return-Path vacío es la marca canónica de una notificación de entrega.
  const returnPath = (h['return-path'] ?? '').trim();
  if (returnPath === '<>' || returnPath === '') {
    if (returnPath === '<>') return { reply: false, reason: 'rebote' };
  }

  if (REMITENTES_AUTOMATICOS.test(from)) return { reply: false, reason: 'remitente_automatico' };
  if (ASUNTOS_AUTOMATICOS.test(subject)) return { reply: false, reason: 'asunto_automatico' };

  // El From de un mail se falsifica trivialmente. El servidor que lo recibe (DonWeb,
  // Gmail, etc.) corre SPF/DKIM y deja el veredicto en Authentication-Results.
  const auth = authResult(h['authentication-results']);
  if (auth === 'fail') return { reply: false, reason: 'spf_dkim_fail' };

  return { reply: true };
}

/**
 * Lee el veredicto de SPF/DKIM que dejó el servidor receptor.
 *
 * Devuelve 'fail' SOLO si ambos mecanismos disponibles fallaron: un DKIM que falla
 * mientras SPF pasa es normal en listas y reenvíos legítimos. Y la ausencia del
 * header NO es una falla: muchos servidores no lo agregan — no podemos rechazar
 * mails reales por eso.
 */
export function authResult(header: string | undefined): 'pass' | 'fail' | 'desconocido' {
  if (!header) return 'desconocido';
  const h = header.toLowerCase();
  const spf = /\bspf=(\w+)/.exec(h)?.[1];
  const dkim = /\bdkim=(\w+)/.exec(h)?.[1];
  const dmarc = /\bdmarc=(\w+)/.exec(h)?.[1];

  // DMARC es el veredicto compuesto: si el dominio lo publica y falla, es falsificación.
  if (dmarc === 'fail') return 'fail';
  if (spf === 'pass' || dkim === 'pass' || dmarc === 'pass') return 'pass';
  if (spf === 'fail' && (dkim === 'fail' || dkim === undefined)) return 'fail';
  return 'desconocido';
}
