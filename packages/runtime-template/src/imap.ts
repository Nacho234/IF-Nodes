/**
 * Adaptador IMAP: el transporte que trae los mails entrantes al bot.
 *
 * Lee los no leídos de la casilla, los normaliza con `parseInboundEmail` y ejecuta
 * el flujo de mail. Es el espejo del webhook de WhatsApp, pero como acá no hay
 * webhook que nos avise, hay que ir a buscarlos cada tanto.
 *
 * Sirve para cualquier casilla con IMAP (DonWeb/Ferozo, Gmail, Outlook, cPanel).
 * Se activa solo si IMAP_HOST está definido; sin eso el bot funciona igual, sin mail entrante.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseInboundEmail, shouldReplyToEmail } from '@ifnodes/node-definitions';
import type { EmailIncomingMessage } from '@ifnodes/node-definitions';

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  /** Carpeta donde van los mails que fallaron, para que no se pierdan en silencio. */
  failedMailbox: string;
  pollSeconds: number;
}

/** Lee la config del entorno. Devuelve null si no hay casilla configurada. */
export function imapConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ImapConfig | null {
  const host = env.IMAP_HOST?.trim();
  const user = env.IMAP_USER?.trim();
  const password = env.IMAP_PASSWORD;
  if (!host || !user || !password) return null;

  const port = Number(env.IMAP_PORT ?? 993) || 993;
  return {
    host,
    port,
    // 993 = SSL implícito; 143 = sin SSL. Se puede forzar con IMAP_SECURE.
    secure: env.IMAP_SECURE ? env.IMAP_SECURE !== 'false' : port !== 143,
    user,
    password,
    mailbox: env.IMAP_MAILBOX?.trim() || 'INBOX',
    failedMailbox: env.IMAP_FAILED_MAILBOX?.trim() || 'INBOX.Fallidos',
    pollSeconds: Math.max(Number(env.IMAP_POLL_SECONDS ?? 60) || 60, 15),
  };
}

/**
 * Convierte un mail crudo (RFC822) al formato interno del bot.
 * Devuelve null si NO hay que contestarlo (auto-respuesta, rebote, lista, spam):
 * responder eso desata bucles infinitos y le abre hilos falsos al CRM.
 */
export async function messageFromSource(source: Buffer): Promise<EmailIncomingMessage | null> {
  const mail = await simpleParser(source);
  const from = mail.from?.value?.[0];
  if (!from?.address) return null;

  // Los headers estándar (RFC 3834 Auto-Submitted, Precedence, Return-Path) son
  // lo único confiable para distinguir una persona de una máquina.
  const headers: Record<string, string> = {};
  for (const [k, v] of mail.headers) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
    else if (v && typeof v === 'object' && 'text' in v) headers[k.toLowerCase()] = String((v as { text: unknown }).text);
  }
  const decision = shouldReplyToEmail({ from: from.address, subject: mail.subject ?? '', headers });
  if (!decision.reply) return null;

  return parseInboundEmail({
    from: from.name ? `${from.name} <${from.address}>` : from.address,
    subject: mail.subject ?? '',
    text: mail.text ?? '',
    html: typeof mail.html === 'string' ? mail.html : '',
    messageId: mail.messageId ?? '',
    inReplyTo: mail.inReplyTo ?? '',
  });
}

type Handler = (message: EmailIncomingMessage) => Promise<void>;
type Log = (level: 'info' | 'warn' | 'error', message: string, extra?: Record<string, unknown>) => void;

/**
 * Poller de la casilla. Cada vuelta abre la conexión, procesa los no leídos y cierra.
 * Reconectar cada vez es más lento que mantener IDLE abierto, pero es mucho más
 * robusto frente a cortes, y a un mail cada tanto no le mueve la aguja.
 */
export class ImapPoller {
  private timer: NodeJS.Timeout | null = null;
  private corriendo = false;

  constructor(
    private readonly config: ImapConfig,
    private readonly onMessage: Handler,
    private readonly log: Log = () => {},
  ) {}

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.config.pollSeconds * 1000);
    this.timer.unref?.();
    this.log('info', 'Casilla IMAP conectada: el bot ya recibe mails', {
      host: this.config.host,
      mailbox: this.config.mailbox,
      cada: `${this.config.pollSeconds}s`,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Una vuelta: trae los no leídos, los procesa y los marca leídos. Público para poder testearlo. */
  async poll(): Promise<number> {
    if (this.corriendo) return 0; // una vuelta lenta no puede pisar a la siguiente
    this.corriendo = true;
    const client = new ImapFlow({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: { user: this.config.user, pass: this.config.password },
      logger: false,
    });

    let procesados = 0;
    try {
      await client.connect();
      // La carpeta de fallidos tiene que existir antes de necesitarla.
      try {
        await client.mailboxCreate(this.config.failedMailbox);
      } catch {
        /* ya existe: es el caso normal */
      }
      const lock = await client.getMailboxLock(this.config.mailbox);
      try {
        for await (const msg of client.fetch({ seen: false }, { source: true, uid: true })) {
          try {
            const parsed = msg.source ? await messageFromSource(msg.source) : null;
            if (!parsed) {
              // Auto-respuesta, rebote, lista o sin remitente: se marca leído y no se contesta.
              this.log('info', 'Mail ignorado (automático o sin remitente)', { uid: msg.uid });
            } else {
              await this.onMessage(parsed);
              procesados += 1;
            }
            // Se marca leído incluso si no se pudo parsear: si no, se reintenta para siempre.
            await client.messageFlagsAdd({ uid: String(msg.uid) }, ['\\Seen'], { uid: true });
          } catch (error) {
            // Un mail que falla no puede cortar la vuelta entera. Y tampoco puede
            // perderse: se mueve a una carpeta para que alguien lo mire. Marcarlo
            // leído y seguir lo hacía desaparecer en silencio.
            this.log('error', 'Falló el procesamiento de un mail: se mueve a la carpeta de fallidos', {
              uid: msg.uid,
              carpeta: this.config.failedMailbox,
              error: error instanceof Error ? error.message : String(error),
            });
            try {
              await client.messageMove({ uid: String(msg.uid) }, this.config.failedMailbox, { uid: true });
            } catch (moveError) {
              // Si la carpeta no existe o el servidor no deja mover, al menos no
              // reintentarlo para siempre: se marca leído y queda el log.
              this.log('warn', 'No se pudo mover el mail fallido; queda leído en la bandeja', {
                uid: msg.uid,
                error: moveError instanceof Error ? moveError.message : String(moveError),
              });
              try {
                await client.messageFlagsAdd({ uid: String(msg.uid) }, ['\\Seen'], { uid: true });
              } catch {
                /* la conexión ya se cayó; se reintenta en la próxima vuelta */
              }
            }
          }
        }
      } finally {
        lock.release();
      }
    } catch (error) {
      this.log('error', 'No se pudo leer la casilla IMAP', {
        host: this.config.host,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      try {
        await client.logout();
      } catch {
        /* la conexión ya estaba caída */
      }
      this.corriendo = false;
    }

    if (procesados > 0) this.log('info', 'Mails entrantes procesados', { procesados });
    return procesados;
  }
}
