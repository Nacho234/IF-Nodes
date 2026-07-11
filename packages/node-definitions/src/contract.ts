import type { ZodType, ZodTypeDef } from 'zod';

export const NODE_CATEGORIES = [
  'trigger',
  'logic',
  'data',
  'communication',
  'ai',
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
export interface AIService {
  generateText(input: AIGenerateInput): Promise<AIGenerateResult>;
  classify(input: AIClassifyInput): Promise<AIClassifyResult>;
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

/**
 * Servicios inyectados: los nodos NUNCA acceden a red/DB/providers por import
 * directo. El worker inyecta implementaciones reales; el runtime exportado, las
 * livianas; el simulador/tests, ninguna (los nodos que las requieren avisan).
 */
export interface NodeServices {
  ai?: AIService;
  http?: HttpService;
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
