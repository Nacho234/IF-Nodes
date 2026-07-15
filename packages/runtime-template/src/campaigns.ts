/**
 * Lanzador de campañas del runtime exportado (fan-out in-process). Lee los
 * contactos persistidos del RuntimeStore según un filtro y corre el flujo de
 * campaña UNA VEZ POR CONTACTO, escalonado para no saturar el canal. Réplica
 * ligera del motor de campañas del panel, para que el bot corra 100% en la
 * infra del cliente sin depender de IF Nodes.
 */
import type { ContactListFilter, RuntimeStore } from './store';
import { runProjectFlow, type LoadedProject, type RuntimeFlow } from './runtime';

export interface RunCampaignOptions extends ContactListFilter {
  /** Milisegundos entre contactos. Por defecto 1000. */
  staggerMs?: number;
  /** Si true, no ejecuta: solo devuelve a cuántos contactos alcanzaría. */
  dryRun?: boolean;
}

export interface CampaignResult {
  matched: number;
  launched: number;
  succeeded: number;
  failed: number;
  dryRun: boolean;
}

const MAX_CONTACTS = 5000;
const DEFAULT_STAGGER_MS = 1000;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Corre una campaña sobre los contactos que matchean el filtro. */
export async function runCampaign(
  project: LoadedProject,
  flow: RuntimeFlow,
  store: RuntimeStore,
  options: RunCampaignOptions = {},
  onEvent?: (event: { contactId: string; status: string }) => void,
): Promise<CampaignResult> {
  const limit = Math.min(options.limit ?? MAX_CONTACTS, MAX_CONTACTS);
  const contacts = await store.listContacts({
    status: options.status,
    tags: options.tags,
    hasPhone: options.hasPhone,
    hasEmail: options.hasEmail,
    limit,
  });

  if (options.dryRun) {
    return { matched: contacts.length, launched: 0, succeeded: 0, failed: 0, dryRun: true };
  }

  const stagger = Math.max(0, options.staggerMs ?? DEFAULT_STAGGER_MS);
  let launched = 0;
  let succeeded = 0;
  let failed = 0;

  for (const [index, contact] of contacts.entries()) {
    if (index > 0 && stagger > 0) await delay(stagger);
    const trigger: Record<string, unknown> = {
      contactId: contact.id,
      name: contact.name,
      phone: contact.phone,
      email: contact.email,
      status: contact.status,
      tags: contact.tags,
    };
    launched += 1;
    try {
      const result = await runProjectFlow(project, flow, trigger);
      if (result.status === 'SUCCEEDED') succeeded += 1;
      else failed += 1;
      onEvent?.({ contactId: contact.id, status: result.status });
    } catch {
      failed += 1;
      onEvent?.({ contactId: contact.id, status: 'ERROR' });
    }
  }

  return { matched: contacts.length, launched, succeeded, failed, dryRun: false };
}
