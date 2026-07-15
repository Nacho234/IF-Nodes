import type { WorkflowGraph } from '@ifnodes/shared';
import { nodeRegistry } from './registry';

/**
 * Análisis de "Puesta en marcha": qué falta conectar/cargar/configurar para que
 * un flujo funcione de verdad (no la validez del grafo — eso es Validar — sino
 * las CONEXIONES: credenciales, conocimiento, variables, setup externo). Es
 * determinístico: no depende del modelo. Lo usa el panel del constructor y el
 * contexto del Copilot para guiar paso a paso.
 */

export type ReadinessLevel = 'error' | 'warning' | 'info';
export type ReadinessCategory = 'credential' | 'knowledge' | 'environment' | 'external';

export interface ReadinessItem {
  level: ReadinessLevel;
  category: ReadinessCategory;
  message: string;
  /** Qué hacer para resolverlo. */
  action?: string;
  nodeId?: string;
}

export interface ReadinessContext {
  /** Slugs de credenciales activas del proyecto (p.ej. ["anthropic","whatsapp-cloud"]). */
  availableCredentialTypes: string[];
  /** Cuántos fragmentos hay en la base de conocimiento del proyecto. */
  knowledgeCount: number;
  /** Claves de variables por entorno definidas. */
  environmentKeys: string[];
}

const CREDENTIAL_LABEL: Record<string, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  'whatsapp-cloud': 'WhatsApp Cloud',
  smtp: 'SMTP (email)',
  'http-bearer': 'HTTP Bearer',
  'api-key': 'API Key',
};

/** Notas de setup externo por tipo de nodo (dependen del usuario, no del sistema). */
const EXTERNAL_NOTES: Record<string, ReadinessItem> = {
  'whatsapp.send-text': {
    level: 'info',
    category: 'external',
    message: 'Para iniciar conversaciones de WhatsApp salientes (fuera de la ventana de 24h) Meta exige plantillas HSM aprobadas.',
    action: 'Aprobá las plantillas en tu cuenta de WhatsApp Business (Meta).',
  },
  'integrations.google-calendar': {
    level: 'info',
    category: 'external',
    message: 'Google Calendar necesita un access token OAuth de Google.',
    action: 'Creá una app OAuth en Google Cloud y guardá el token como credencial HTTP Bearer.',
  },
};

const ENV_REF = /\{\{\s*environment\.([A-Za-z0-9_]+)\s*\}\}/g;

export function analyzeReadiness(graph: WorkflowGraph, ctx: ReadinessContext): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const available = new Set(ctx.availableCredentialTypes);
  const seenExternal = new Set<string>();
  const activeNodes = graph.nodes.filter((n) => !n.disabled);

  for (const node of activeNodes) {
    const def = nodeRegistry.get(node.type);
    if (!def) continue;

    // Credenciales que el nodo pide
    for (const requirement of def.credentials ?? []) {
      if (available.has(requirement.type)) continue;
      const label = CREDENTIAL_LABEL[requirement.type] ?? requirement.type;
      if (requirement.required) {
        items.push({
          level: 'error',
          category: 'credential',
          nodeId: node.id,
          message: `El nodo "${node.name}" necesita una credencial de tipo ${label} y no hay ninguna cargada.`,
          action: `Andá a Credenciales → Nueva credencial → ${label} y completá el secreto.`,
        });
      } else {
        items.push({
          level: 'warning',
          category: 'credential',
          nodeId: node.id,
          message: `El nodo "${node.name}" corre en modo simulado: sin credencial ${label} no manda/consulta de verdad.`,
          action: `Cargá una credencial ${label} en Credenciales para que funcione real.`,
        });
      }
    }

    // Setup externo por tipo de nodo (una sola vez)
    const external = EXTERNAL_NOTES[node.type];
    if (external && !seenExternal.has(node.type)) {
      seenExternal.add(node.type);
      items.push(external);
    }
  }

  // Conocimiento vacío pero se usa el nodo de búsqueda
  const usesKnowledge = activeNodes.some((n) => n.type === 'ai.knowledge-search');
  if (usesKnowledge && ctx.knowledgeCount === 0) {
    items.push({
      level: 'warning',
      category: 'knowledge',
      message: 'Usás "Buscar conocimiento" pero la base de conocimiento del proyecto está vacía.',
      action: 'Cargá fragmentos (FAQ, tono, políticas) en la sección Base de conocimiento.',
    });
  }

  // Variables por entorno referenciadas pero no definidas
  const envKeys = new Set(ctx.environmentKeys);
  const referenced = new Set<string>();
  for (const node of activeNodes) {
    const json = JSON.stringify(node.config ?? {});
    for (const match of json.matchAll(ENV_REF)) {
      const key = match[1];
      if (key) referenced.add(key);
    }
  }
  for (const key of referenced) {
    if (!envKeys.has(key)) {
      items.push({
        level: 'warning',
        category: 'environment',
        message: `El flujo usa {{environment.${key}}} pero esa variable no está definida.`,
        action: `Agregá ${key} en Variables por entorno.`,
      });
    }
  }

  const order: Record<ReadinessLevel, number> = { error: 0, warning: 1, info: 2 };
  return items.sort((a, b) => order[a.level] - order[b.level]);
}
