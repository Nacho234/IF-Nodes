/**
 * Importa el histórico de mails de la casilla del equipo al historial del bot.
 *
 * El problema de importar una bandeja real es separar las charlas con clientes del
 * ruido: facturas, newsletters, mail interno, spam. La respuesta está en el CRM:
 * se importa SOLO lo que va o viene de una dirección que ya es un contacto. Una
 * agencia está en la base; la factura del hosting no.
 *
 * Es de solo lectura sobre la casilla: no marca nada leído ni mueve nada.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject } from 'mailparser';
import { shouldReplyToEmail, stripQuotedReply } from '@ifnodes/node-definitions';
import type { ImapConfig } from './imap';
import type { RuntimeStore } from './store';

export interface ImportOptions {
  /** Solo desde esta fecha (ISO). Sin esto, toda la casilla. */
  since?: string;
  /** Cuenta y reporta sin escribir nada. */
  dryRun?: boolean;
  /** Techo de mails a escanear. */
  limit?: number;
}

export interface ImportResult {
  escaneados: number;
  /** Interlocutor que existe en el CRM. */
  deContactos: number;
  importados: number;
  hilos: number;
  ignorados: { sinContacto: number; automaticos: number; sinCuerpo: number };
  dryRun: boolean;
}

type Log = (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;

const direcciones = (a: AddressObject | AddressObject[] | undefined): string[] => {
  if (!a) return [];
  const arr = Array.isArray(a) ? a : [a];
  return arr.flatMap((x) => (x.value ?? []).map((v) => (v.address ?? '').toLowerCase()).filter(Boolean));
};

/**
 * Recorre la casilla y guarda cada mail como turno de la conversación del contacto.
 * Los que mandó el equipo quedan como `operator` (los escribió una persona, no el bot).
 */
export async function importEmailHistory(
  config: ImapConfig,
  store: RuntimeStore,
  options: ImportOptions = {},
  log: Log = () => {},
): Promise<ImportResult> {
  const res: ImportResult = {
    escaneados: 0,
    deContactos: 0,
    importados: 0,
    hilos: 0,
    ignorados: { sinContacto: 0, automaticos: 0, sinCuerpo: 0 },
    dryRun: Boolean(options.dryRun),
  };

  const nuestras = new Set([config.user.toLowerCase()]);
  const hilosTocados = new Set<string>();
  const limit = Math.min(options.limit ?? 20_000, 50_000);

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(config.mailbox);
  try {
    const criterio = options.since ? { since: new Date(options.since) } : { all: true };
    for await (const msg of client.fetch(criterio, { source: true, uid: true })) {
      if (res.escaneados >= limit) break;
      res.escaneados += 1;
      if (!msg.source) continue;

      let mail;
      try {
        mail = await simpleParser(msg.source);
      } catch {
        continue;
      }

      const from = direcciones(mail.from)[0];
      if (!from) continue;
      const to = [...direcciones(mail.to), ...direcciones(mail.cc)];

      // Automáticos, rebotes y listas nunca son una charla con un cliente.
      const headers: Record<string, string> = {};
      for (const [k, v] of mail.headers) if (typeof v === 'string') headers[k.toLowerCase()] = v;
      if (!shouldReplyToEmail({ from, subject: mail.subject ?? '', headers }).reply) {
        res.ignorados.automaticos += 1;
        continue;
      }

      // ¿Lo mandó el equipo o el contacto? El interlocutor es el otro extremo.
      const salienteNuestro = nuestras.has(from);
      const candidatos = salienteNuestro ? to.filter((a) => !nuestras.has(a)) : [from];

      let contacto: string | null = null;
      for (const dir of candidatos) {
        if (await store.contactFind({ email: dir })) {
          contacto = dir;
          break;
        }
      }
      if (!contacto) {
        res.ignorados.sinContacto += 1;
        continue;
      }
      res.deContactos += 1;

      const cuerpo = stripQuotedReply(mail.text ?? '');
      if (!cuerpo) {
        res.ignorados.sinCuerpo += 1;
        continue;
      }

      hilosTocados.add(contacto);
      if (!res.dryRun) {
        await store.memorySave(
          'email',
          contacto,
          salienteNuestro ? 'operator' : 'user',
          cuerpo.slice(0, 4000),
          mail.date ?? undefined,
        );
      }
      res.importados += 1;
    }
  } finally {
    lock.release();
    try {
      await client.logout();
    } catch {
      /* la conexión ya estaba caída */
    }
  }

  res.hilos = hilosTocados.size;
  log('info', res.dryRun ? 'Simulación de importación del histórico' : 'Histórico de mails importado', { ...res });
  return res;
}
