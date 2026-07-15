/**
 * Núcleo del runtime exportado. Carga y valida uno o varios flujos del proyecto
 * y los ejecuta con el mismo motor que el builder (@ifnodes/workflow-core).
 * Soporta un proyecto COMPLETO (varios flujos) con un orquestador que rutea:
 * entrada (WhatsApp/webhook) → flujo inbound, campañas → flujo por contacto,
 * cron → flujos programados. La persistencia (memoria + contactos) va por el
 * RuntimeStore; el conocimiento (RAG) viaja en knowledge.json.
 */
import {
  validateGraphStructure,
  workflowGraphSchema,
  type WorkflowGraph,
} from '@ifnodes/shared';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { executeWorkflow, type ExecuteWorkflowResult } from '@ifnodes/workflow-core';
import type { KnowledgeChunkLike } from '@ifnodes/node-definitions';
import { buildRuntimeServices, type CredentialManifest } from './services';
import type { RuntimeStore } from './store';

export interface RuntimeManifest {
  project: string;
  runtimeVersion: string;
  workflowVersion: string;
  entrypoints: string[];
  requiredEnvironmentVariables: string[];
  healthEndpoint: string;
}

/** Un flujo del proyecto, tal como viaja en flows.json. */
export interface FlowBundle {
  id: string;
  name: string;
  slug: string;
  graph: unknown;
}

/** Flujo ya cargado y validado, con su trigger principal identificado. */
export interface RuntimeFlow {
  id: string;
  name: string;
  slug: string;
  graph: WorkflowGraph;
  triggerType: string | null;
}

export interface LoadedProject {
  flows: RuntimeFlow[];
  manifest: RuntimeManifest;
  services: ReturnType<typeof buildRuntimeServices>;
}

const MAX_STEPS = 200;
const MAX_DURATION_MS = 60_000;

const INBOUND_PRIORITY = ['trigger.whatsapp-message', 'trigger.webhook', 'trigger.manual'];

/** Tipo del primer nodo trigger activo del grafo (el disparador del flujo). */
function primaryTriggerType(graph: WorkflowGraph): string | null {
  const trigger = graph.nodes.find((node) => !node.disabled && nodeRegistry.isTrigger(node.type));
  return trigger?.type ?? null;
}

/** Carga y valida un proyecto completo (uno o varios flujos). */
export function loadProject(
  rawFlows: FlowBundle[],
  manifest: RuntimeManifest,
  credentials: CredentialManifest,
  knowledge: KnowledgeChunkLike[] = [],
  store?: RuntimeStore,
): LoadedProject {
  const services = buildRuntimeServices(credentials, knowledge, store);
  const flows: RuntimeFlow[] = rawFlows.map((raw) => {
    const graph = workflowGraphSchema.parse(raw.graph);
    const errors = validateGraphStructure(graph, (type) => nodeRegistry.isTrigger(type)).filter(
      (issue) => issue.level === 'error',
    );
    if (errors.length > 0) {
      throw new Error(`El flujo "${raw.name}" no es válido: ${errors.map((e) => e.message).join(' · ')}`);
    }
    return { id: raw.id, name: raw.name, slug: raw.slug, graph, triggerType: primaryTriggerType(graph) };
  });
  return { flows, manifest, services };
}

/* ── Selectores del orquestador ──────────────────────────────── */

/** Flujo que atiende mensajes entrantes (WhatsApp > webhook > manual). */
export function inboundFlow(project: LoadedProject): RuntimeFlow | null {
  for (const type of INBOUND_PRIORITY) {
    const flow = project.flows.find((f) => f.triggerType === type);
    if (flow) return flow;
  }
  return null;
}

export function whatsappFlow(project: LoadedProject): RuntimeFlow | null {
  return project.flows.find((f) => f.triggerType === 'trigger.whatsapp-message') ?? null;
}

export function campaignFlows(project: LoadedProject): RuntimeFlow[] {
  return project.flows.filter((f) => f.triggerType === 'trigger.campaign-contact');
}

export function scheduleFlows(project: LoadedProject): RuntimeFlow[] {
  return project.flows.filter((f) => f.triggerType === 'trigger.schedule');
}

export function flowBySlug(project: LoadedProject, slug: string): RuntimeFlow | null {
  return project.flows.find((f) => f.slug === slug || f.id === slug) ?? null;
}

/** Lee cron + timezone del nodo "Programado" de un flujo (para el scheduler). */
export function scheduleConfig(flow: RuntimeFlow): { cron: string; timezone: string } | null {
  const node = flow.graph.nodes.find((n) => !n.disabled && n.type === 'trigger.schedule');
  if (!node) return null;
  const cfg = (node.config ?? {}) as { cron?: string; timezone?: string };
  return {
    cron: cfg.cron ?? '0 9 * * *',
    timezone: cfg.timezone ?? 'America/Argentina/Buenos_Aires',
  };
}

/* ── Ejecución ───────────────────────────────────────────────── */

/** Ejecuta un flujo del proyecto con la entrada dada (payload del trigger). */
export async function runProjectFlow(
  project: LoadedProject,
  flow: RuntimeFlow,
  triggerInput: Record<string, unknown>,
): Promise<ExecuteWorkflowResult> {
  const environment: Record<string, unknown> = { ...process.env };
  return executeWorkflow({
    graph: flow.graph,
    ids: {
      executionId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId: project.manifest.project,
      workflowId: flow.id,
      versionId: project.manifest.workflowVersion,
    },
    trigger: triggerInput,
    environment,
    services: project.services,
    resolveDefinition: (type, version) => nodeRegistry.get(type, version),
    limits: { maxSteps: MAX_STEPS, maxDurationMs: MAX_DURATION_MS },
  });
}

/** Extrae la respuesta del flujo (salida del nodo Respuesta) para el caller. */
export function replyFromResult(result: ExecuteWorkflowResult): unknown {
  const final = result.finalOutput as { message?: unknown } | undefined;
  if (final && typeof final === 'object' && 'message' in final) return final.message;
  return result.finalOutput;
}
