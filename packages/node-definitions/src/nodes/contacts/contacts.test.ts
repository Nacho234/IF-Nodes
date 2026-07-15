import { describe, expect, it } from 'vitest';
import { contactUpsertNode } from './upsert';
import { contactFindNode } from './find';
import { nodeRegistry } from '../../registry';
import {
  NodeExecutionError,
  type ContactIdentity,
  type ContactRecord,
  type ContactService,
  type ContactUpsertInput,
  type NodeExecutionContext,
  type NodeLogger,
  type NodeServices,
} from '../../contract';

const silentLogger: NodeLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** CRM falso en memoria para probar los nodos sin DB. */
function fakeContacts(): ContactService {
  const store: ContactRecord[] = [];
  let seq = 0;
  const match = (c: ContactRecord, id: ContactIdentity) =>
    (Boolean(id.phone) && c.phone === id.phone) || (Boolean(id.email) && c.email === id.email);
  return {
    async find(id) {
      return store.find((c) => match(c, id)) ?? null;
    },
    async upsert(input: ContactUpsertInput) {
      const existing = store.find((c) => match(c, input));
      if (existing) {
        if (input.status !== undefined) existing.status = input.status;
        if (input.tags) existing.tags = Array.from(new Set([...existing.tags, ...input.tags]));
        if (input.name !== undefined) existing.name = input.name;
        return existing;
      }
      const rec: ContactRecord = {
        id: `c${(seq += 1)}`,
        name: input.name ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        status: input.status ?? 'new',
        tags: input.tags ?? [],
        notes: input.notes ?? null,
        data: input.data ?? null,
      };
      store.push(rec);
      return rec;
    },
  };
}

function ctx<C>(config: C, services: NodeServices): NodeExecutionContext<C, unknown> {
  return { config, input: {}, nodeId: 'n', executionId: 'e', logger: silentLogger, signal: new AbortController().signal, services };
}

describe('nodos de contactos', () => {
  it('están registrados', () => {
    const types = nodeRegistry.all().map((d) => d.type);
    expect(types).toContain('contacts.upsert');
    expect(types).toContain('contacts.find');
  });

  it('upsert crea y luego actualiza el mismo contacto (por teléfono)', async () => {
    const services = { contacts: fakeContacts() };
    const created = await contactUpsertNode.execute(
      ctx({ phone: '549341', email: '', name: 'Ana', status: 'new', tags: 'vip', notes: '', markContacted: false }, services),
    );
    const c1 = (created as { output: { contact: ContactRecord } }).output.contact;
    expect(c1.status).toBe('new');
    expect(c1.tags).toContain('vip');

    const updated = await contactUpsertNode.execute(
      ctx({ phone: '549341', email: '', name: '', status: 'replied', tags: 'interesado', notes: '', markContacted: false }, services),
    );
    const c2 = (updated as { output: { contact: ContactRecord } }).output.contact;
    expect(c2.id).toBe(c1.id); // mismo contacto
    expect(c2.status).toBe('replied');
    expect(c2.tags).toEqual(expect.arrayContaining(['vip', 'interesado'])); // etiquetas acumuladas
  });

  it('find devuelve found=false si no existe y true si existe', async () => {
    const services = { contacts: fakeContacts() };
    const miss = await contactFindNode.execute(ctx({ phone: '000', email: '' }, services));
    expect((miss as { output: { found: boolean } }).output.found).toBe(false);

    await contactUpsertNode.execute(
      ctx({ phone: '549341', email: '', name: 'Ana', status: '', tags: '', notes: '', markContacted: false }, services),
    );
    const hit = await contactFindNode.execute(ctx({ phone: '549341', email: '' }, services));
    expect((hit as { output: { found: boolean } }).output.found).toBe(true);
  });

  it('sin identidad (ni teléfono ni email) lanza error', async () => {
    const services = { contacts: fakeContacts() };
    await expect(
      contactUpsertNode.execute(ctx({ phone: '', email: '', name: '', status: '', tags: '', notes: '', markContacted: false }, services)),
    ).rejects.toBeInstanceOf(NodeExecutionError);
  });

  it('sin servicio de contactos lanza error', async () => {
    await expect(contactFindNode.execute(ctx({ phone: '549341', email: '' }, {}))).rejects.toBeInstanceOf(NodeExecutionError);
  });
});
