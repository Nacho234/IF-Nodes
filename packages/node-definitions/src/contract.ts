import type { ZodType, ZodTypeDef } from 'zod';

export const NODE_CATEGORIES = [
  'trigger',
  'logic',
  'data',
  'communication',
  'ai',
  'memory',
  'contacts',
  'whatsapp',
  'integrations',
] as const;
export type NodeCategory = (typeof NODE_CATEGORIES)[number];

export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: 'Disparadores',
  logic: 'Lógica',
  data: 'Datos',
  communication: 'Comunicación',
  ai: 'Inteligencia artificial',
  memory: 'Memoria',
  contacts: 'Contactos',
  whatsapp: 'WhatsApp',
  integrations: 'Integraciones',
};

export interface NodePortDefinition {
  id: string;
  label: string;
  description?: string;
}

/** Pista para el autocompletado de variables ({{nodes.<id>.output.<path>}}) */
export interface OutputVariableHint {
  path: string;
  description: string;
}

export interface CredentialRequirement {
  /** Tipo de credencial (Fase 7), p.ej. "whatsapp-cloud", "openai" */
  type: string;
  required: boolean;
}

/** Cómo renderizar un campo de config en el panel derecho del editor */
export interface ConfigFieldUiHint {
  field: string;
  label: string;
  helpText?: string;
  widget: 'text' | 'textarea' | 'code' | 'select' | 'switch' | 'number' | 'keyvalue' | 'credential';
  options?: { value: string; label: string }[];
  placeholder?: string;
  /** El campo admite expresiones {{ ... }} */
  supportsExpressions?: boolean;
  /** Para widget 'credential': slugs de tipo aceptados (p.ej. ['openai','anthropic']) */
  credentialTypes?: string[];
}

export interface NodeLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

/* ── Servicios inyectados (implementados por el worker/runtime) ── */

export interface AIGenerateInput {
  credentialId?: string;
  model?: string;
  system?: string;
  prompt: string;
  maxTokens?: number;
}
export interface AIGenerateResult {
  text: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}
export interface AIClassifyInput {
  credentialId?: string;
  model?: string;
  text: string;
  categories: string[];
}
export interface AIClassifyResult {
  category: string;
  provider: string;
  model: string;
}
/* ── Tool-calling (para el nodo Agente) ─────────────────────── */

export interface AIToolDefinition {
  name: string;
  description: string;
  /** JSON Schema de los parámetros de la herramienta. */
  parameters: Record<string, unknown>;
}
export interface AIToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface AIChatMessage {
  role: 'user' | 'assistant' | 'tool';
  /** Texto (user/assistant). */
  content?: string;
  /** Solo assistant: herramientas que pidió usar el modelo. */
  toolCalls?: AIToolCall[];
  /** Solo tool: a qué tool_call responde. */
  toolCallId?: string;
  /** Solo tool: resultado (texto) de la herramienta. */
  toolResult?: string;
  isError?: boolean;
}
export interface AIChatInput {
  credentialId?: string;
  model?: string;
  system?: string;
  messages: AIChatMessage[];
  tools?: AIToolDefinition[];
  maxTokens?: number;
}
export interface AIChatResult {
  /** Texto de la respuesta del modelo (puede ir vacío si solo pidió tools). */
  text: string;
  /** Herramientas que el modelo quiere ejecutar en este turno. */
  toolCalls: AIToolCall[];
  /** "tool_use" | "end_turn" | … */
  stopReason: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AIService {
  generateText(input: AIGenerateInput): Promise<AIGenerateResult>;
  classify(input: AIClassifyInput): Promise<AIClassifyResult>;
  /** Un turno de conversación con tool-calling. El nodo Agente maneja el loop. */
  chat(input: AIChatInput): Promise<AIChatResult>;
}

export interface HttpRequestInput {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  credentialId?: string;
}
export interface HttpResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
}
export interface HttpService {
  request(input: HttpRequestInput): Promise<HttpResult>;
}

export interface WhatsAppSendInput {
  credentialId?: string;
  /** Número destino (E.164 sin +), típicamente {{trigger.phone}} */
  to: string;
  text: string;
}
export interface WhatsAppSendResult {
  to: string;
  text: string;
  /** true si se envió por la API real; false si fue simulado (sin credencial) */
  sent: boolean;
  simulated: boolean;
  messageId?: string;
}
export interface WhatsAppService {
  sendText(input: WhatsAppSendInput): Promise<WhatsAppSendResult>;
}

/* ── Email (SMTP) ────────────────────────────────────────────── */

export interface EmailSendInput {
  credentialId?: string;
  to: string;
  subject: string;
  text: string;
  /** Cuerpo HTML opcional (si va, se manda multipart con el texto como fallback). */
  html?: string;
  /** Remitente. Si falta, se usa el usuario de la credencial SMTP. */
  from?: string;
}
export interface EmailSendResult {
  to: string;
  subject: string;
  /** true si se envió por SMTP real; false si fue simulado (sin credencial). */
  sent: boolean;
  simulated: boolean;
  messageId?: string;
}
export interface EmailService {
  send(input: EmailSendInput): Promise<EmailSendResult>;
}

/* ── Contactos / CRM ─────────────────────────────────────────── */

export interface ContactIdentity {
  phone?: string;
  email?: string;
}
export interface ContactUpsertInput extends ContactIdentity {
  name?: string;
  /** Etapa del pipeline (libre): new/contacted/replied/meeting/closed… */
  status?: string;
  tags?: string[];
  notes?: string;
  data?: Record<string, unknown>;
  /** Si true, marca lastContactedAt = ahora. */
  markContacted?: boolean;
}
export interface ContactRecord {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  tags: string[];
  notes: string | null;
  data: Record<string, unknown> | null;
}

/**
 * Contactos/CRM: personas con las que el agente interactúa, con estado en el
 * tiempo. El worker la implementa contra la DB; el runtime exportado, en
 * memoria del proceso (efímera).
 */
export interface ContactService {
  upsert(input: ContactUpsertInput): Promise<ContactRecord>;
  find(identity: ContactIdentity): Promise<ContactRecord | null>;
}

/* ── Base de conocimiento (RAG) ──────────────────────────────── */

export interface KnowledgeSearchInput {
  query: string;
  limit?: number;
}
export interface KnowledgeHit {
  id: string;
  title: string | null;
  content: string;
  score: number;
}
export interface KnowledgeSearchResult {
  hits: KnowledgeHit[];
  /** Fragmentos concatenados, listos para inyectar en el prompt del agente. */
  context: string;
}

/**
 * Búsqueda en la base de conocimiento del proyecto (FAQ, tono, políticas). v1
 * por palabras clave; el resultado (`context`) se inyecta en el prompt de un
 * nodo de IA para respuestas fundamentadas. El worker busca en la DB; el
 * runtime exportado, sobre el knowledge.json empaquetado.
 */
export interface KnowledgeService {
  search(input: KnowledgeSearchInput): Promise<KnowledgeSearchResult>;
}

/* ── Memoria de conversación ─────────────────────────────────── */

export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationTurn {
  role: ConversationRole;
  text: string;
}
export interface MemoryLoadInput {
  /** Canal de la conversación, p.ej. "whatsapp". */
  channel: string;
  /** Identificador del contacto en ese canal (teléfono, email…). */
  contact: string;
  /** Cuántos turnos recientes traer (por defecto 10). */
  limit?: number;
}
export interface MemoryLoadResult {
  conversationId: string;
  turns: ConversationTurn[];
  /** Historial formateado listo para inyectar en el prompt de IA. */
  transcript: string;
  /** Estado de la conversación: "open" | "handoff" | "closed". */
  status: string;
}
export interface MemorySaveInput {
  channel: string;
  contact: string;
  role: ConversationRole;
  text: string;
}
export interface MemorySaveResult {
  conversationId: string;
}
export interface MemorySetStatusInput {
  channel: string;
  contact: string;
  /** "open" | "handoff" | "closed". */
  status: string;
}

/**
 * Memoria de conversación: le da estado al agente entre mensajes. El worker la
 * implementa contra la DB; el runtime exportado, en memoria del proceso
 * (efímera). Los nodos que la usan degradan a "sin historial" si no está.
 */
export interface MemoryService {
  loadHistory(input: MemoryLoadInput): Promise<MemoryLoadResult>;
  saveTurn(input: MemorySaveInput): Promise<MemorySaveResult>;
  /** Cambia el estado de la conversación (p.ej. a "handoff" al escalar a humano). */
  setStatus(input: MemorySetStatusInput): Promise<{ conversationId: string }>;
}

/**
 * Servicios inyectados: los nodos NUNCA acceden a red/DB/providers por import
 * directo. El worker inyecta implementaciones reales; el runtime exportado, las
 * livianas; el simulador/tests, ninguna (los nodos que las requieren avisan).
 */
export interface NodeServices {
  ai?: AIService;
  http?: HttpService;
  whatsapp?: WhatsAppService;
  memory?: MemoryService;
  email?: EmailService;
  contacts?: ContactService;
  knowledge?: KnowledgeService;
}

export interface NodeExecutionContext<TConfig = unknown, TInput = unknown> {
  /** Config ya validada por configSchema y con expresiones resueltas */
  config: TConfig;
  input: TInput;
  nodeId: string;
  executionId: string;
  logger: NodeLogger;
  signal: AbortSignal;
  services: NodeServices;
}

export type NodeExecutionResult<TOutput = unknown> = (
  | { output: TOutput }
  | { outputsByPort: Record<string, unknown> }
) & {
  /** Variables a fusionar en context.variables (p.ej. nodo "Establecer variable") */
  variables?: Record<string, unknown>;
};

export class NodeExecutionError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    options: { retryable?: boolean; details?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'NodeExecutionError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export interface NodeDefinition<TConfig = unknown, TInput = unknown, TOutput = unknown> {
  /** Identificador único con namespace: "trigger.manual", "logic.condition" */
  type: string;
  /** Se incrementa ante cambios incompatibles; las versiones viejas se conservan */
  version: number;
  category: NodeCategory;
  displayName: string;
  description: string;
  /** Nombre de icono Lucide; la web lo resuelve a componente */
  icon: string;

  /** Input `unknown` para admitir schemas con .default()/.transform() */
  configSchema: ZodType<TConfig, ZodTypeDef, unknown>;
  defaultConfig: TConfig;
  uiHints: ConfigFieldUiHint[];

  inputs: NodePortDefinition[];
  outputs: NodePortDefinition[];

  credentials?: CredentialRequirement[];
  outputVariables?: OutputVariableHint[];

  execute(context: NodeExecutionContext<TConfig, TInput>): Promise<NodeExecutionResult<TOutput>>;

  documentation?: string;
  /** Si puede incluirse en un runtime exportado (los de simulación no) */
  exportable: boolean;
}

/** Helper de inferencia para definir nodos sin repetir genéricos */
export function defineNode<TConfig, TInput, TOutput>(
  definition: NodeDefinition<TConfig, TInput, TOutput>,
): NodeDefinition<TConfig, TInput, TOutput> {
  return definition;
}
