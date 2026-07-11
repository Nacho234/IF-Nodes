/**
 * Núcleo del runtime exportado: carga y valida el workflow, y ejecuta el flujo
 * usando el mismo motor que el builder (@ifnodes/workflow-core). Sin base de datos.
 */
import {
  validateGraphStructure,
  workflowGraphSchema,
  type WorkflowGraph,
} from '@ifnodes/shared';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { executeWorkflow, type ExecuteWorkflowResult } from '@ifnodes/workflow-core';
import { buildRuntimeServices, type CredentialManifest } from './services';

export interface RuntimeManifest {
  project: string;
  runtimeVersion: string;
  workflowVersion: string;
  entrypoints: string[];
  requiredEnvironmentVariables: string[];
  healthEndpoint: string;
}

export interface LoadedRuntime {
  graph: WorkflowGraph;
  manifest: RuntimeManifest;
  services: ReturnType<typeof buildRuntimeServices>;
  hasWhatsAppTrigger: boolean;
}

const MAX_STEPS = 200;
const MAX_DURATION_MS = 60_000;

export function loadRuntime(
  rawWorkflow: unknown,
  manifest: RuntimeManifest,
  credentials: CredentialManifest,
): LoadedRuntime {
  const graph = workflowGraphSchema.parse(rawWorkflow);
  const errors = validateGraphStructure(graph, (type) => nodeRegistry.isTrigger(type)).filter(
    (issue) => issue.level === 'error',
  );
  if (errors.length > 0) {
    throw new Error(`El workflow no es válido: ${errors.map((e) => e.message).join(' · ')}`);
  }
  const hasWhatsAppTrigger = graph.nodes.some(
    (node) => !node.disabled && node.type === 'trigger.whatsapp-message',
  );
  return { graph, manifest, services: buildRuntimeServices(credentials), hasWhatsAppTrigger };
}

/** Ejecuta el flujo con la entrada dada (payload del trigger). */
export async function runFlow(
  loaded: LoadedRuntime,
  triggerInput: Record<string, unknown>,
): Promise<ExecuteWorkflowResult> {
  const environment: Record<string, unknown> = { ...process.env };
  return executeWorkflow({
    graph: loaded.graph,
    ids: {
      executionId: `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      projectId: loaded.manifest.project,
      workflowId: 'exported',
      versionId: loaded.manifest.workflowVersion,
    },
    trigger: triggerInput,
    environment,
    services: loaded.services,
    resolveDefinition: (type, version) => nodeRegistry.get(type, version),
    limits: { maxSteps: MAX_STEPS, maxDurationMs: MAX_DURATION_MS },
  });
}

/** Extrae la respuesta del flujo (salida del nodo Respuesta) para devolverla al caller. */
export function replyFromResult(result: ExecuteWorkflowResult): unknown {
  const final = result.finalOutput as { message?: unknown } | undefined;
  if (final && typeof final === 'object' && 'message' in final) return final.message;
  return result.finalOutput;
}
