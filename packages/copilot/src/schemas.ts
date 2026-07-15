import { z } from 'zod';

/**
 * Contratos del IF Copilot. Tipos neutrales (no atados a ningún proveedor de
 * IA) para conversación y propuestas de cambio. El proveedor concreto (Claude)
 * mapea desde/hacia estos tipos; la API y la DB persisten estos mismos.
 */

/* ── Conversación ───────────────────────────────────────────── */

export const copilotRoleSchema = z.enum(['user', 'assistant']);
export type CopilotRole = z.infer<typeof copilotRoleSchema>;

export const copilotMessageSchema = z.object({
  role: copilotRoleSchema,
  content: z.string(),
});
export type CopilotChatMessage = z.infer<typeof copilotMessageSchema>;

/* ── Propuestas de cambio (ChangeSet) ───────────────────────────
 *
 * Fase 2: el modelo PROPONE cambios y el usuario los aplica (con revisión). Un
 * conjunto de cambios se procesa en orden y puede armar un flujo entero:
 * agregar nodos (con un `ref` temporal), conectarlos, configurarlos y borrar.
 * `applyChangeSet` valida todo contra el registro y el grafo antes de aplicar.
 */

/** Agregar un nodo. `ref` es un identificador temporal para que otras
 *  operaciones del mismo conjunto (p.ej. add_edge) lo referencien antes de que
 *  exista su id real. */
export const addNodeChangeSchema = z.object({
  op: z.literal('add_node'),
  ref: z.string().max(64).optional(),
  /** Tipo registrado en node-definitions, p.ej. "logic.condition". */
  nodeType: z.string().min(1).max(100),
  name: z.string().min(1).max(120),
  /** Config inicial sugerida (parcial); se fusiona con el default del nodo. */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Atajo: id de un nodo EXISTENTE desde el cual conectar hacia el nuevo. */
  connectFromNodeId: z.string().max(64).optional(),
  sourcePort: z.string().max(40).default('main'),
  reason: z.string().max(500).default(''),
});
export type AddNodeChange = z.infer<typeof addNodeChangeSchema>;

/** Conectar dos nodos. `from`/`to` pueden ser ids existentes o `ref` de nodos
 *  agregados en este mismo conjunto. */
export const addEdgeChangeSchema = z.object({
  op: z.literal('add_edge'),
  from: z.string().min(1).max(64),
  fromPort: z.string().max(40).default('main'),
  to: z.string().min(1).max(64),
  toPort: z.string().max(40).default('main'),
});
export type AddEdgeChange = z.infer<typeof addEdgeChangeSchema>;

/** Cambiar la config de un nodo existente (se fusiona con la actual). */
export const updateConfigChangeSchema = z.object({
  op: z.literal('update_config'),
  nodeId: z.string().min(1).max(64),
  config: z.record(z.string(), z.unknown()),
  reason: z.string().max(500).default(''),
});
export type UpdateConfigChange = z.infer<typeof updateConfigChangeSchema>;

/** Eliminar un nodo existente (y sus conexiones). */
export const deleteNodeChangeSchema = z.object({
  op: z.literal('delete_node'),
  nodeId: z.string().min(1).max(64),
  reason: z.string().max(500).default(''),
});
export type DeleteNodeChange = z.infer<typeof deleteNodeChangeSchema>;

export const copilotChangeSchema = z.discriminatedUnion('op', [
  addNodeChangeSchema,
  addEdgeChangeSchema,
  updateConfigChangeSchema,
  deleteNodeChangeSchema,
]);
export type CopilotChange = z.infer<typeof copilotChangeSchema>;

export const copilotChangeSetSchema = z.object({
  /** Resumen en una frase de lo que propone el conjunto de cambios. */
  summary: z.string().min(1).max(500),
  changes: z.array(copilotChangeSchema).min(1).max(40),
});
export type CopilotChangeSet = z.infer<typeof copilotChangeSetSchema>;

/**
 * JSON Schema de la herramienta `propose_changes` que se le expone al modelo.
 * Se mantiene a mano (en vez de derivarlo de Zod) para controlar exactamente
 * lo que ve el modelo y cumplir con strict tool use (additionalProperties:false
 * + required). El shape debe seguir a `copilotChangeSetSchema`.
 */
export const PROPOSE_CHANGES_TOOL = {
  name: 'propose_changes',
  description:
    'Proponé una modificación concreta al flujo actual. Sirve para armar un flujo entero: ' +
    'los cambios se procesan en orden. Operaciones (campo "op"): ' +
    '"add_node" (agregar nodo; poné un "ref" único si otra operación lo va a conectar), ' +
    '"add_edge" (conectar; "from"/"to" pueden ser un id existente o un "ref" de este mismo conjunto), ' +
    '"update_config" (cambiar la config de un nodo existente por su "nodeId"), ' +
    '"delete_node" (borrar un nodo existente por su "nodeId"). ' +
    'La propuesta se le MUESTRA al usuario para que la revise y la aplique; no se aplica sola. ' +
    'Usá SOLO tipos de nodo de la lista "Nodos disponibles" del contexto, y referenciá nodos ' +
    'existentes con el id exacto que figura en el flujo. Todo flujo necesita un disparador (nodo sin entradas).',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'changes'],
    properties: {
      summary: {
        type: 'string',
        description: 'Resumen en una frase de lo que hace este conjunto de cambios.',
      },
      changes: {
        type: 'array',
        description: 'Lista de cambios a aplicar, en orden.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['op'],
          properties: {
            op: {
              type: 'string',
              enum: ['add_node', 'add_edge', 'update_config', 'delete_node'],
            },
            // add_node
            ref: {
              type: 'string',
              description: 'add_node: identificador temporal para que add_edge lo referencie.',
            },
            nodeType: { type: 'string', description: 'add_node: tipo registrado, p.ej. "logic.condition".' },
            name: { type: 'string', description: 'add_node: nombre visible del nuevo nodo.' },
            config: {
              type: 'object',
              description: 'add_node/update_config: config (parcial); se fusiona con la del nodo.',
            },
            connectFromNodeId: {
              type: 'string',
              description: 'add_node (atajo): id de un nodo existente desde el cual conectar hacia el nuevo.',
            },
            sourcePort: { type: 'string', description: 'add_node: puerto de salida del origen (default "main").' },
            // add_edge
            from: { type: 'string', description: 'add_edge: id existente o ref del nodo origen.' },
            fromPort: { type: 'string', description: 'add_edge: puerto de salida (default "main", o "true"/"false").' },
            to: { type: 'string', description: 'add_edge: id existente o ref del nodo destino.' },
            toPort: { type: 'string', description: 'add_edge: puerto de entrada (default "main").' },
            // update_config / delete_node
            nodeId: { type: 'string', description: 'update_config/delete_node: id del nodo existente.' },
            reason: { type: 'string', description: 'Por qué proponés este cambio.' },
          },
        },
      },
    },
  },
} as const;

/**
 * Valida una propuesta cruda (el `input` que devolvió el modelo al llamar la
 * herramienta) contra el contrato. Devuelve el ChangeSet tipado o un error.
 */
export function parseChangeSet(
  raw: unknown,
): { ok: true; changeSet: CopilotChangeSet } | { ok: false; error: string } {
  const result = copilotChangeSetSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, changeSet: result.data };
}

/* ── Plan de proyecto (Fase 3: orquestación multi-flujo) ─────────
 *
 * El Copilot puede proponer un PROYECTO entero: varios flujos (cada uno se crea
 * como un workflow con su grafo) + fragmentos de conocimiento a sembrar. Los
 * secretos NO entran acá: las credenciales las carga el usuario (el readiness
 * lo guía). El backend valida y aplica todo o nada.
 */

export const copilotFlowPlanSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  changes: z.array(copilotChangeSchema).min(1).max(80),
});
export type CopilotFlowPlan = z.infer<typeof copilotFlowPlanSchema>;

export const copilotKnowledgeSeedSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1).max(20_000),
  tags: z.array(z.string().max(40)).max(10).default([]),
});
export type CopilotKnowledgeSeed = z.infer<typeof copilotKnowledgeSeedSchema>;

export const copilotProjectPlanSchema = z.object({
  summary: z.string().min(1).max(1000),
  flows: z.array(copilotFlowPlanSchema).min(1).max(6),
  knowledge: z.array(copilotKnowledgeSeedSchema).max(30).default([]),
});
export type CopilotProjectPlan = z.infer<typeof copilotProjectPlanSchema>;

export function parseProjectPlan(
  raw: unknown,
): { ok: true; plan: CopilotProjectPlan } | { ok: false; error: string } {
  const result = copilotProjectPlanSchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return { ok: true, plan: result.data };
}

/** Los mismos campos de cambio que propose_changes, para reutilizar en el plan. */
const CHANGE_ITEM_SCHEMA = PROPOSE_CHANGES_TOOL.input_schema.properties.changes.items;

/**
 * Herramienta `build_project`: el modelo propone un proyecto entero (varios
 * flujos + conocimiento). El backend lo valida (Zod) y lo aplica.
 */
export const BUILD_PROJECT_TOOL = {
  name: 'build_project',
  description:
    'Armá un PROYECTO entero: varios flujos (cada uno con su disparador y sus nodos) + fragmentos de ' +
    'conocimiento a sembrar. Usala cuando el usuario pide construir un agente/bot completo de una. ' +
    'Cada flujo tiene UN solo disparador (un flujo por punto de entrada: mensaje entrante, campaña, cron…). ' +
    'Usá SOLO tipos de nodo de la lista "Nodos disponibles". Los secretos NO van acá (el usuario carga las ' +
    'credenciales aparte). La propuesta se le MUESTRA al usuario para que la revise y la aplique.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'flows'],
    properties: {
      summary: { type: 'string', description: 'Resumen del proyecto y de los flujos que lo componen.' },
      flows: {
        type: 'array',
        description: 'Los flujos del proyecto. Cada uno se crea como un workflow con su grafo.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['name', 'changes'],
          properties: {
            name: { type: 'string', description: 'Nombre del flujo (p.ej. "Conversación entrante").' },
            description: { type: 'string', description: 'Qué hace el flujo.' },
            changes: {
              type: 'array',
              description: 'Cambios que arman el grafo del flujo (mismas ops que propose_changes).',
              items: CHANGE_ITEM_SCHEMA,
            },
          },
        },
      },
      knowledge: {
        type: 'array',
        description: 'Fragmentos de conocimiento a sembrar (FAQ, tono, políticas).',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['content'],
          properties: {
            title: { type: 'string' },
            content: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
} as const;
