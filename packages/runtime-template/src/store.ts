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

export interface RuntimeStore {
  memoryLoad(channel: string, contact: string, limit: number): Promise<{ turns: ConversationTurn[]; status: string }>;
  memorySave(channel: string, contact: string, role: string, text: string): Promise<void>;
  memorySetStatus(channel: string, contact: string, status: string): Promise<void>;
  contactUpsert(input: ContactUpsertInput): Promise<ContactRecord>;
  contactFind(identity: ContactIdentity): Promise<ContactRecord | null>;
  listContacts(filter: ContactListFilter): Promise<ContactRecord[]>;
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
  async memorySave(channel: string, contact: string, role: string, text: string) {
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
}

/* ── Postgres / Supabase (persistente) ──────────────────────── */

export class PostgresStore implements RuntimeStore {
  private pool: Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
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
  async memorySave(channel: string, contact: string, role: string, text: string) {
    await this.pool.query(
      `INSERT INTO ifn_conversations (channel, contact, last_message_at) VALUES ($1, $2, now())
       ON CONFLICT (channel, contact) DO UPDATE SET last_message_at = now()`,
      [channel, contact],
    );
    await this.pool.query('INSERT INTO ifn_messages (channel, contact, role, text) VALUES ($1, $2, $3, $4)', [
      channel,
      contact,
      role,
      text,
    ]);
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
}

/** Elige el store según el entorno: Postgres si hay URL, si no en memoria. */
export function createRuntimeStore(): RuntimeStore {
  const url = process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL || '';
  return url ? new PostgresStore(url) : new InMemoryStore();
}
