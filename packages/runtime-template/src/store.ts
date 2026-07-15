/**
 * Persistencia del runtime exportado. Pluggable: en memoria del proceso (por
 * defecto, efímero) o en Postgres/Supabase si se configura una URL de base de
 * datos. Esto habilita que el bot exportado corra COMPLETO en la infra del
 * cliente (memoria de conversación + contactos persistidos), sin depender de
 * IF Nodes. El conocimiento (RAG) viaja aparte en knowledge.json.
 */
import { Pool } from 'pg';
import type {
  ContactIdentity,
  ContactRecord,
  ContactUpsertInput,
  ConversationTurn,
} from '@ifnodes/node-definitions';

/** Filtro para listar contactos (lanzador de campañas del runtime). */
export interface ContactListFilter {
  status?: string;
  tags?: string[];
  hasPhone?: boolean;
  hasEmail?: boolean;
  limit?: number;
}

/** Contacto que viaja en el export (contacts.json) para sembrar el CRM del cliente. */
export interface ContactSeed {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string;
  tags?: string[];
  notes?: string | null;
  data?: Record<string, unknown> | null;
}

/** Hilo de conversación que viaja en el export (conversations.json) para sembrar la memoria. */
export interface ConversationSeed {
  channel: string;
  contact: string;
  status?: string;
  messages: { role: string; text: string; createdAt?: string }[];
}

export interface RuntimeStore {
  memoryLoad(channel: string, contact: string, limit: number): Promise<{ turns: ConversationTurn[]; status: string }>;
  /** `at` preserva la fecha original (importar historial); si falta, es ahora. */
  memorySave(channel: string, contact: string, role: string, text: string, at?: Date): Promise<void>;
  memorySetStatus(channel: string, contact: string, status: string): Promise<void>;
  contactUpsert(input: ContactUpsertInput): Promise<ContactRecord>;
  contactFind(identity: ContactIdentity): Promise<ContactRecord | null>;
  listContacts(filter: ContactListFilter): Promise<ContactRecord[]>;
  /** Carga inicial de contactos (solo si el CRM está vacío). Idempotente. */
  seedContacts(contacts: ContactSeed[]): Promise<{ seeded: number; skipped: boolean }>;
  /** Carga inicial del historial (solo si no hay ninguna conversación). Idempotente. */
  seedConversations(threads: ConversationSeed[]): Promise<{ seeded: number; turns: number; skipped: boolean }>;
  init?(): Promise<void>;
}

/* ── En memoria (efímero) ────────────────────────────────────── */

export class InMemoryStore implements RuntimeStore {
  private turns = new Map<string, ConversationTurn[]>();
  private status = new Map<string, string>();
  private contacts: ContactRecord[] = [];
  private seq = 0;
  private key(channel: string, contact: string) {
    return `${channel}:${contact}`;
  }
  private matches(c: ContactRecord, id: ContactIdentity) {
    return (Boolean(id.phone) && c.phone === id.phone) || (Boolean(id.email) && c.email === id.email);
  }

  async memoryLoad(channel: string, contact: string, limit: number) {
    const k = this.key(channel, contact);
    return { turns: (this.turns.get(k) ?? []).slice(-limit), status: this.status.get(k) ?? 'open' };
  }
  async memorySave(channel: string, contact: string, role: string, text: string, _at?: Date) {
    const k = this.key(channel, contact);
    const arr = this.turns.get(k) ?? [];
    arr.push({ role: role as ConversationTurn['role'], text });
    this.turns.set(k, arr);
  }
  async memorySetStatus(channel: string, contact: string, status: string) {
    this.status.set(this.key(channel, contact), status);
  }
  async contactFind(identity: ContactIdentity) {
    return this.contacts.find((c) => this.matches(c, identity)) ?? null;
  }
  async listContacts(filter: ContactListFilter): Promise<ContactRecord[]> {
    let out = this.contacts.filter((c) => {
      if (filter.status && c.status !== filter.status) return false;
      if (filter.tags && filter.tags.length > 0 && !filter.tags.some((t) => c.tags.includes(t))) return false;
      if (filter.hasPhone && !c.phone) return false;
      if (filter.hasEmail && !c.email) return false;
      return true;
    });
    if (filter.limit) out = out.slice(0, filter.limit);
    return out;
  }
  async contactUpsert(input: ContactUpsertInput): Promise<ContactRecord> {
    const existing = this.contacts.find((c) => this.matches(c, input));
    if (existing) {
      if (input.name !== undefined) existing.name = input.name;
      if (input.phone !== undefined) existing.phone = input.phone;
      if (input.email !== undefined) existing.email = input.email;
      if (input.status !== undefined) existing.status = input.status;
      if (input.tags) existing.tags = Array.from(new Set([...existing.tags, ...input.tags]));
      if (input.notes !== undefined) existing.notes = input.notes;
      if (input.data) existing.data = { ...(existing.data ?? {}), ...input.data };
      return existing;
    }
    const record: ContactRecord = {
      id: `contact_${(this.seq += 1)}`,
      name: input.name ?? null,
      phone: input.phone ?? null,
      email: input.email ?? null,
      status: input.status ?? 'new',
      tags: input.tags ?? [],
      notes: input.notes ?? null,
      data: input.data ?? null,
    };
    this.contacts.push(record);
    return record;
  }
  async seedContacts(contacts: ContactSeed[]) {
    if (this.contacts.length > 0) return { seeded: 0, skipped: true };
    let seeded = 0;
    for (const c of contacts) {
      if (!c.phone && !c.email) continue;
      // Reusa el upsert para respetar el dedup por teléfono/email de la semilla.
      // La semilla viene de la DB (null); el upsert espera undefined.
      const before = this.contacts.length;
      await this.contactUpsert({
        name: c.name ?? undefined,
        phone: c.phone ?? undefined,
        email: c.email ?? undefined,
        status: c.status ?? 'new',
        tags: c.tags ?? [],
        notes: c.notes ?? undefined,
        data: c.data ?? undefined,
      });
      if (this.contacts.length > before) seeded += 1;
    }
    return { seeded, skipped: false };
  }
  async seedConversations(threads: ConversationSeed[]) {
    if (this.turns.size > 0) return { seeded: 0, turns: 0, skipped: true };
    let seeded = 0, turns = 0;
    for (const t of threads) {
      if (!t.contact || !t.messages?.length) continue;
      const k = this.key(t.channel, t.contact);
      this.turns.set(k, t.messages.map((m) => ({ role: m.role as ConversationTurn['role'], text: m.text })));
      if (t.status) this.status.set(k, t.status);
      seeded += 1;
      turns += t.messages.length;
    }
    return { seeded, turns, skipped: false };
  }
}

/* ── Postgres / Supabase (persistente) ──────────────────────── */

/**
 * SSL para la conexión. Los Postgres gestionados (Supabase, Neon, RDS, Railway)
 * exigen TLS; localhost normalmente no. Reglas: `sslmode=disable` o
 * `RUNTIME_DB_SSL=false` → sin SSL; localhost sin sslmode → sin SSL; el resto
 * → SSL (rejectUnauthorized false para aceptar el cert del pooler gestionado).
 */
export function resolveSsl(connectionString: string): false | { rejectUnauthorized: boolean } {
  const force = (process.env.RUNTIME_DB_SSL ?? '').toLowerCase();
  if (force === 'false' || force === '0' || force === 'disable') return false;
  if (force === 'true' || force === '1' || force === 'require') return { rejectUnauthorized: false };
  let host = '';
  let sslmode = '';
  try {
    const url = new URL(connectionString);
    host = url.hostname;
    sslmode = url.searchParams.get('sslmode') ?? '';
  } catch {
    /* string no-URL: caemos a la heurística por defecto */
  }
  if (sslmode === 'disable') return false;
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '';
  if (isLocal && !sslmode) return false;
  return { rejectUnauthorized: false };
}

export class PostgresStore implements RuntimeStore {
  private pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, ssl: resolveSsl(connectionString) });
  }

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ifn_conversations (
        channel TEXT NOT NULL, contact TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
        last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (channel, contact));
      CREATE TABLE IF NOT EXISTS ifn_messages (
        id BIGSERIAL PRIMARY KEY, channel TEXT NOT NULL, contact TEXT NOT NULL,
        role TEXT NOT NULL, text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      CREATE INDEX IF NOT EXISTS ifn_messages_conv ON ifn_messages (channel, contact, created_at);
      CREATE TABLE IF NOT EXISTS ifn_contacts (
        id BIGSERIAL PRIMARY KEY, phone TEXT, email TEXT, name TEXT, status TEXT NOT NULL DEFAULT 'new',
        tags TEXT[] NOT NULL DEFAULT '{}', notes TEXT, data JSONB, last_contacted_at TIMESTAMPTZ);
      CREATE UNIQUE INDEX IF NOT EXISTS ifn_contacts_phone ON ifn_contacts (phone) WHERE phone IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS ifn_contacts_email ON ifn_contacts (email) WHERE email IS NOT NULL;
    `);
  }

  async memoryLoad(channel: string, contact: string, limit: number) {
    const conv = await this.pool.query<{ status: string }>(
      'SELECT status FROM ifn_conversations WHERE channel = $1 AND contact = $2',
      [channel, contact],
    );
    const rows = await this.pool.query<{ role: string; text: string }>(
      'SELECT role, text FROM ifn_messages WHERE channel = $1 AND contact = $2 ORDER BY created_at DESC LIMIT $3',
      [channel, contact, limit],
    );
    const turns = rows.rows.reverse().map((r) => ({ role: r.role as ConversationTurn['role'], text: r.text }));
    return { turns, status: conv.rows[0]?.status ?? 'open' };
  }
  async memorySave(channel: string, contact: string, role: string, text: string, at?: Date) {
    await this.pool.query(
      `INSERT INTO ifn_conversations (channel, contact, last_message_at) VALUES ($1, $2, COALESCE($3::timestamptz, now()))
       ON CONFLICT (channel, contact) DO UPDATE SET last_message_at = GREATEST(ifn_conversations.last_message_at, EXCLUDED.last_message_at)`,
      [channel, contact, at ?? null],
    );
    await this.pool.query(
      'INSERT INTO ifn_messages (channel, contact, role, text, created_at) VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))',
      [channel, contact, role, text, at ?? null],
    );
  }
  async memorySetStatus(channel: string, contact: string, status: string) {
    await this.pool.query(
      `INSERT INTO ifn_conversations (channel, contact, status) VALUES ($1, $2, $3)
       ON CONFLICT (channel, contact) DO UPDATE SET status = $3`,
      [channel, contact, status],
    );
  }

  private rowToContact(r: {
    id: number;
    name: string | null;
    phone: string | null;
    email: string | null;
    status: string;
    tags: string[];
    notes: string | null;
    data: Record<string, unknown> | null;
  }): ContactRecord {
    return {
      id: String(r.id),
      name: r.name,
      phone: r.phone,
      email: r.email,
      status: r.status,
      tags: r.tags,
      notes: r.notes,
      data: r.data,
    };
  }
  private async findRow(identity: ContactIdentity) {
    if (identity.phone) {
      const r = await this.pool.query('SELECT * FROM ifn_contacts WHERE phone = $1 LIMIT 1', [identity.phone]);
      if (r.rows[0]) return r.rows[0];
    }
    if (identity.email) {
      const r = await this.pool.query('SELECT * FROM ifn_contacts WHERE email = $1 LIMIT 1', [identity.email]);
      if (r.rows[0]) return r.rows[0];
    }
    return null;
  }
  async contactFind(identity: ContactIdentity) {
    const row = await this.findRow(identity);
    return row ? this.rowToContact(row) : null;
  }
  async listContacts(filter: ContactListFilter): Promise<ContactRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (filter.tags && filter.tags.length > 0) {
      params.push(filter.tags);
      where.push(`tags && $${params.length}`);
    }
    if (filter.hasPhone) where.push('phone IS NOT NULL');
    if (filter.hasEmail) where.push('email IS NOT NULL');
    const limit = Math.min(Math.max(filter.limit ?? 1000, 1), 5000);
    params.push(limit);
    const sql = `SELECT * FROM ifn_contacts ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY last_contacted_at ASC NULLS FIRST, id ASC LIMIT $${params.length}`;
    const r = await this.pool.query(sql, params);
    return r.rows.map((row) => this.rowToContact(row));
  }
  async contactUpsert(input: ContactUpsertInput): Promise<ContactRecord> {
    const existing = await this.findRow(input);
    const contacted = input.markContacted ? ', last_contacted_at = now()' : '';
    if (existing) {
      const tags = input.tags ? Array.from(new Set([...(existing.tags ?? []), ...input.tags])) : existing.tags;
      const data = input.data ? { ...(existing.data ?? {}), ...input.data } : existing.data;
      const r = await this.pool.query(
        `UPDATE ifn_contacts SET name = COALESCE($2, name), phone = COALESCE($3, phone), email = COALESCE($4, email),
           status = COALESCE($5, status), tags = $6, notes = COALESCE($7, notes), data = $8 ${contacted}
         WHERE id = $1 RETURNING *`,
        [existing.id, input.name ?? null, input.phone ?? null, input.email ?? null, input.status ?? null, tags, input.notes ?? null, data],
      );
      return this.rowToContact(r.rows[0]);
    }
    const r = await this.pool.query(
      `INSERT INTO ifn_contacts (name, phone, email, status, tags, notes, data, last_contacted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, ${input.markContacted ? 'now()' : 'NULL'}) RETURNING *`,
      [input.name ?? null, input.phone ?? null, input.email ?? null, input.status ?? 'new', input.tags ?? [], input.notes ?? null, input.data ?? null],
    );
    return this.rowToContact(r.rows[0]);
  }
  /**
   * Siembra el CRM SOLO si está vacío: una vez desplegado, el estado de los
   * contactos lo maneja el bot (contacted/replied/…), y un redeploy no debe
   * pisarlo. Inserta por lotes; `ON CONFLICT DO NOTHING` cubre teléfonos o
   * emails repetidos dentro de la propia semilla.
   */
  async seedContacts(contacts: ContactSeed[]) {
    const existing = await this.pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM ifn_contacts');
    if (Number(existing.rows[0]?.n ?? '0') > 0) return { seeded: 0, skipped: true };

    const usable = contacts.filter((c) => c.phone || c.email);
    const BATCH = 500;
    let seeded = 0;
    for (let i = 0; i < usable.length; i += BATCH) {
      const batch = usable.slice(i, i + BATCH);
      const params: unknown[] = [];
      const rows = batch.map((c) => {
        const base = params.length;
        params.push(
          c.name ?? null,
          c.phone ?? null,
          c.email ?? null,
          c.status ?? 'new',
          c.tags ?? [],
          c.notes ?? null,
          c.data ?? null,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
      });
      const r = await this.pool.query(
        `INSERT INTO ifn_contacts (name, phone, email, status, tags, notes, data)
         VALUES ${rows.join(', ')} ON CONFLICT DO NOTHING`,
        params,
      );
      seeded += r.rowCount ?? 0;
    }
    return { seeded, skipped: false };
  }
  /**
   * Siembra el historial SOLO si no hay ninguna conversación: una vez desplegado,
   * las charlas las escribe el bot y un redeploy no puede pisarlas.
   */
  async seedConversations(threads: ConversationSeed[]) {
    const existing = await this.pool.query<{ n: string }>('SELECT COUNT(*)::text AS n FROM ifn_conversations');
    if (Number(existing.rows[0]?.n ?? '0') > 0) return { seeded: 0, turns: 0, skipped: true };

    let seeded = 0, turns = 0;
    for (const t of threads) {
      if (!t.contact || !t.messages?.length) continue;
      const last = t.messages[t.messages.length - 1]?.createdAt;
      await this.pool.query(
        `INSERT INTO ifn_conversations (channel, contact, status, last_message_at)
         VALUES ($1, $2, $3, COALESCE($4::timestamptz, now()))
         ON CONFLICT (channel, contact) DO NOTHING`,
        [t.channel, t.contact, t.status ?? 'open', last ?? null],
      );
      for (const m of t.messages) {
        await this.pool.query(
          `INSERT INTO ifn_messages (channel, contact, role, text, created_at)
           VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, now()))`,
          [t.channel, t.contact, m.role, m.text, m.createdAt ?? null],
        );
        turns += 1;
      }
      seeded += 1;
    }
    return { seeded, turns, skipped: false };
  }
}

/** Elige el store según el entorno: Postgres si hay URL, si no en memoria. */
export function createRuntimeStore(): RuntimeStore {
  const url = process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL || '';
  return url ? new PostgresStore(url) : new InMemoryStore();
}
