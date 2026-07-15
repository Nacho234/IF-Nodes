import { describe, expect, it, afterEach } from 'vitest';
import { resolveSsl, InMemoryStore } from './store';

describe('resolveSsl', () => {
  const orig = process.env.RUNTIME_DB_SSL;
  afterEach(() => {
    if (orig === undefined) delete process.env.RUNTIME_DB_SSL;
    else process.env.RUNTIME_DB_SSL = orig;
  });

  it('localhost sin sslmode → sin SSL', () => {
    expect(resolveSsl('postgresql://u:p@localhost:5432/db')).toBe(false);
    expect(resolveSsl('postgresql://u:p@127.0.0.1:5432/db')).toBe(false);
  });
  it('host remoto (Supabase) → SSL', () => {
    expect(resolveSsl('postgresql://u:p@db.abc.supabase.co:5432/postgres')).toEqual({ rejectUnauthorized: false });
  });
  it('sslmode=disable → sin SSL aunque sea remoto', () => {
    expect(resolveSsl('postgresql://u:p@host.remoto:5432/db?sslmode=disable')).toBe(false);
  });
  it('localhost con sslmode=require → SSL', () => {
    expect(resolveSsl('postgresql://u:p@localhost:5432/db?sslmode=require')).toEqual({ rejectUnauthorized: false });
  });
  it('RUNTIME_DB_SSL=false fuerza sin SSL', () => {
    process.env.RUNTIME_DB_SSL = 'false';
    expect(resolveSsl('postgresql://u:p@db.supabase.co:5432/db')).toBe(false);
  });
  it('RUNTIME_DB_SSL=true fuerza SSL en localhost', () => {
    process.env.RUNTIME_DB_SSL = 'true';
    expect(resolveSsl('postgresql://u:p@localhost:5432/db')).toEqual({ rejectUnauthorized: false });
  });
});

describe('InMemoryStore.seedContacts (carga inicial del CRM)', () => {
  it('siembra en un CRM vacío, ignorando contactos sin teléfono ni email', async () => {
    const s = new InMemoryStore();
    const r = await s.seedContacts([
      { name: 'A', phone: '1', status: 'new', tags: ['Argentina'] },
      { name: 'B', email: 'b@x.com', status: 'contacted' },
      { name: 'Sin identidad' },
    ]);
    expect(r).toEqual({ seeded: 2, skipped: false });
    expect((await s.listContacts({})).length).toBe(2);
  });

  it('NO pisa un CRM ya poblado (un redeploy no resetea el estado del bot)', async () => {
    const s = new InMemoryStore();
    await s.contactUpsert({ name: 'Ya existe', phone: '1', status: 'replied' });
    const r = await s.seedContacts([{ name: 'Nuevo', phone: '2', status: 'new' }]);
    expect(r).toEqual({ seeded: 0, skipped: true });
    const all = await s.listContacts({});
    expect(all.length).toBe(1);
    expect(all[0]?.status).toBe('replied');
  });

  it('dedup por teléfono repetido dentro de la propia semilla', async () => {
    const s = new InMemoryStore();
    const r = await s.seedContacts([
      { name: 'A', phone: '1' },
      { name: 'A dup', phone: '1' },
    ]);
    expect(r.seeded).toBe(1);
    expect((await s.listContacts({})).length).toBe(1);
  });
});

describe('InMemoryStore.listContacts (filtros del lanzador de campañas)', () => {
  it('filtra por estado, tag y presencia de teléfono/email', async () => {
    const s = new InMemoryStore();
    await s.contactUpsert({ name: 'A', phone: '1', status: 'new', tags: ['Argentina'] });
    await s.contactUpsert({ name: 'B', email: 'b@x.com', status: 'contacted', tags: ['Chile'] });
    await s.contactUpsert({ name: 'C', phone: '3', status: 'new', tags: ['Argentina'] });
    expect((await s.listContacts({ status: 'new' })).length).toBe(2);
    expect((await s.listContacts({ tags: ['Chile'] })).length).toBe(1);
    expect((await s.listContacts({ hasEmail: true })).length).toBe(1);
    expect((await s.listContacts({ status: 'new', limit: 1 })).length).toBe(1);
  });
});
