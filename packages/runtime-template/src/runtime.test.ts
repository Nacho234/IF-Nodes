import { describe, expect, it } from 'vitest';
import {
  inboundFlow,
  whatsappFlow,
  campaignFlows,
  scheduleFlows,
  flowBySlug,
  scheduleConfig,
  type LoadedProject,
  type RuntimeFlow,
} from './runtime';

function flow(slug: string, triggerType: string | null, nodes: unknown[] = []): RuntimeFlow {
  return { id: slug, name: slug, slug, triggerType, graph: { nodes, edges: [], stickyNotes: [], groups: [] } as never };
}
function project(flows: RuntimeFlow[]): LoadedProject {
  return { flows, manifest: {} as never, services: {} as never };
}

const wa = flow('inbound', 'trigger.whatsapp-message');
const camp = flow('campana', 'trigger.campaign-contact');
const sched = flow('seguimiento', 'trigger.schedule', [
  { type: 'trigger.schedule', disabled: false, config: { cron: '0 10 * * 1', timezone: 'UTC' } },
]);
const webhook = flow('hook', 'trigger.webhook');
const manual = flow('manual', 'trigger.manual');

describe('orquestador — selectores', () => {
  it('inboundFlow prioriza WhatsApp > webhook > manual', () => {
    expect(inboundFlow(project([manual, webhook, wa]))!.slug).toBe('inbound');
    expect(inboundFlow(project([manual, webhook]))!.slug).toBe('hook');
    expect(inboundFlow(project([manual]))!.slug).toBe('manual');
    expect(inboundFlow(project([camp, sched]))).toBeNull();
  });

  it('whatsappFlow, campaignFlows y scheduleFlows filtran por trigger', () => {
    const p = project([wa, camp, sched]);
    expect(whatsappFlow(p)!.slug).toBe('inbound');
    expect(campaignFlows(p).map((f) => f.slug)).toEqual(['campana']);
    expect(scheduleFlows(p).map((f) => f.slug)).toEqual(['seguimiento']);
  });

  it('flowBySlug encuentra por slug o id', () => {
    const p = project([wa, camp]);
    expect(flowBySlug(p, 'campana')!.slug).toBe('campana');
    expect(flowBySlug(p, 'inbound')!.id).toBe('inbound');
    expect(flowBySlug(p, 'noexiste')).toBeNull();
  });

  it('scheduleConfig lee cron y timezone del nodo Programado', () => {
    expect(scheduleConfig(sched)).toEqual({ cron: '0 10 * * 1', timezone: 'UTC' });
    expect(scheduleConfig(wa)).toBeNull();
  });
});
