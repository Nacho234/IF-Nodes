import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock del motor: runProjectFlow no ejecuta el grafo real, devuelve un estado fijo.
const { runProjectFlow } = vi.hoisted(() => ({
  runProjectFlow: vi.fn(
    async (_project: unknown, _flow: unknown, _trigger: Record<string, unknown>) =>
      ({ status: 'SUCCEEDED' }) as { status: string },
  ),
}));
vi.mock('./runtime', () => ({ runProjectFlow }));

import { runCampaign } from './campaigns';
import { InMemoryStore } from './store';
import type { LoadedProject, RuntimeFlow } from './runtime';

const flow = { id: 'camp', name: 'Campaña', slug: 'campana', graph: {}, triggerType: 'trigger.campaign-contact' } as unknown as RuntimeFlow;
const project = { flows: [flow], manifest: {}, services: {} } as unknown as LoadedProject;

async function seed(): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  await store.contactUpsert({ name: 'A', phone: '111', status: 'new', tags: ['Argentina'] });
  await store.contactUpsert({ name: 'B', email: 'b@x.com', status: 'contacted', tags: ['Chile'] });
  await store.contactUpsert({ name: 'C', phone: '333', status: 'new', tags: ['Argentina'] });
  return store;
}

beforeEach(() => runProjectFlow.mockClear());

describe('runCampaign', () => {
  it('dryRun cuenta los contactos que matchean sin ejecutar', async () => {
    const store = await seed();
    const res = await runCampaign(project, flow, store, { status: 'new', dryRun: true });
    expect(res.matched).toBe(2);
    expect(res.launched).toBe(0);
    expect(runProjectFlow).not.toHaveBeenCalled();
  });

  it('filtra por tag y hasPhone', async () => {
    const store = await seed();
    const res = await runCampaign(project, flow, store, { tags: ['Argentina'], hasPhone: true, dryRun: true });
    expect(res.matched).toBe(2); // A y C (Argentina + phone)
  });

  it('ejecuta el flujo una vez por contacto y cuenta éxitos', async () => {
    const store = await seed();
    const res = await runCampaign(project, flow, store, { status: 'new', staggerMs: 0 });
    expect(res.launched).toBe(2);
    expect(res.succeeded).toBe(2);
    expect(res.failed).toBe(0);
    expect(runProjectFlow).toHaveBeenCalledTimes(2);
    // El trigger de cada ejecución lleva los datos del contacto
    const [, , trigger] = runProjectFlow.mock.calls[0]!;
    expect(trigger).toMatchObject({ contactId: expect.any(String), status: 'new' });
  });

  it('cuenta fallos cuando el flujo no termina en SUCCEEDED', async () => {
    runProjectFlow.mockResolvedValueOnce({ status: 'FAILED' });
    const store = await seed();
    const res = await runCampaign(project, flow, store, { status: 'new', staggerMs: 0 });
    expect(res.succeeded + res.failed).toBe(2);
    expect(res.failed).toBeGreaterThanOrEqual(1);
  });

  it('respeta el límite', async () => {
    const store = await seed();
    const res = await runCampaign(project, flow, store, { limit: 1, staggerMs: 0 });
    expect(res.launched).toBe(1);
  });
});
