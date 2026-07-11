/**
 * Motor de ejecución de flujos — PURO: sin IO, sin Prisma, sin HTTP.
 * Recibe el grafo, el contexto y callbacks; el builder (worker) y el
 * runtime exportado lo invocan con sus propias implementaciones.
 * Contrato documentado en WORKFLOW_ENGINE.md.
 */
import {
  validateGraphStructure,
  type GraphEdge,
  type GraphNode,
  type NodeErrorPolicy,
  type WorkflowError,
  type WorkflowGraph,
} from '@ifnodes/shared';
import { resolveDeep } from '@ifnodes/expression-engine';
import {
  NodeExecutionError,
  type NodeDefinition,
  type NodeLogger,
  type NodeServices,
} from '@ifnodes/node-definitions';

/* ── Tipos públicos ─────────────────────────────────────────── */

export interface WorkflowExecutionContext {
  executionId: string;
  projectId: string;
  workflowId: string;
  versionId: string | null;
  trigger: Record<string, unknown>;
  variables: Record<string, unknown>;
  nodeOutputs: Record<string, unknown>;
  environment: Record<string, unknown>;
  startedAt: string;
}

export type StepStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export interface StepRecord {
  nodeId: string;
  nodeType: string;
  nodeVersion: number;
  nodeName: string;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error?: WorkflowError;
  attempt: number;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  order: number;
}

export interface LogEntry {
  nodeId?: string;
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  data?: Record<string, unknown>;
}

export interface EngineHooks {
  /** Se llama al iniciar cada paso (para persistir/emitir en vivo) */
  onStepStart?(step: StepRecord): void | Promise<void>;
  /** Se llama al terminar cada paso (éxito, fallo o salteo) */
  onStepFinish?(step: StepRecord): void | Promise<void>;
  onLog?(entry: LogEntry): void | Promise<void>;
}

export interface ExecuteWorkflowOptions {
  graph: WorkflowGraph;
  ids: { executionId: string; projectId: string; workflowId: string; versionId: string | null };
  trigger?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  services?: NodeServices;
  resolveDefinition(type: string, version?: number): NodeDefinition | undefined;
  signal?: AbortSignal;
  limits?: { maxSteps?: number; maxDurationMs?: number; defaultNodeTimeoutMs?: number };
  hooks?: EngineHooks;
}

export type ExecutionStatus = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';

export interface ExecuteWorkflowResult {
  status: ExecutionStatus;
  error?: WorkflowError;
  failedNodeId?: string;
  steps: StepRecord[];
  context: WorkflowExecutionContext;
  /** Salida del último nodo ejecutado sin salidas conectadas (nodo terminal) */
  finalOutput: unknown;
}

const DEFAULT_LIMITS = { maxSteps: 200, maxDurationMs: 60_000, defaultNodeTimeoutMs: 30_000 };

const DEFAULT_POLICY: Required<Omit<NodeErrorPolicy, 'fallbackValue'>> & { fallbackValue?: unknown } = {
  strategy: 'stop',
  retries: 0,
  retryDelayMs: 1_000,
  backoff: 'exponential',
  timeoutMs: 30_000,
};

/* ── Helpers ────────────────────────────────────────────────── */

function toWorkflowError(error: unknown, nodeId: string): WorkflowError {
  if (error instanceof NodeExecutionError) {
    return {
      code: error.code,
      message: error.message,
      nodeId,
      retryable: error.retryable,
      details: error.details,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return {
      code: error.name === 'TimeoutError' ? 'NODE_TIMEOUT' : 'NODE_ERROR',
      message: error.message,
      nodeId,
      retryable: error.name === 'TimeoutError',
      stack: error.stack,
    };
  }
  return { code: 'NODE_ERROR', message: String(error), nodeId, retryable: false };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Ejecución cancelada'));
      },
      { once: true },
    );
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`El nodo superó el tiempo máximo (${ms} ms)`);
      error.name = 'TimeoutError';
      reject(error);
    }, ms);
  });
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Ejecución cancelada')), { once: true });
  });
  try {
    return await Promise.race([promise, timeout, aborted]);
  } finally {
    clearTimeout(timer);
  }
}

/* ── Motor ──────────────────────────────────────────────────── */

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecuteWorkflowResult> {
  const limits = { ...DEFAULT_LIMITS, ...options.limits };
  const startedAtMs = Date.now();
  const context: WorkflowExecutionContext = {
    executionId: options.ids.executionId,
    projectId: options.ids.projectId,
    workflowId: options.ids.workflowId,
    versionId: options.ids.versionId,
    trigger: options.trigger ?? {},
    variables: options.variables ?? {},
    nodeOutputs: {},
    environment: options.environment ?? {},
    startedAt: new Date(startedAtMs).toISOString(),
  };
  const steps: StepRecord[] = [];
  const hooks = options.hooks ?? {};

  const fail = (error: WorkflowError, status: ExecutionStatus = 'FAILED'): ExecuteWorkflowResult => ({
    status,
    error,
    failedNodeId: error.nodeId,
    steps,
    context,
    finalOutput: undefined,
  });

  // 1. Validación estructural (los errores bloquean; los warnings no)
  const isTriggerDef = (type: string): boolean => {
    const definition = options.resolveDefinition(type);
    if (!definition) return false;
    return definition.category === 'trigger' || definition.inputs.length === 0;
  };
  const issues = validateGraphStructure(options.graph, isTriggerDef);
  const structureErrors = issues.filter((issue) => issue.level === 'error');
  if (structureErrors.length > 0) {
    return fail({
      code: 'GRAPH_INVALID',
      message: structureErrors.map((issue) => issue.message).join(' · '),
      retryable: false,
    });
  }

  const activeNodes = options.graph.nodes.filter((node) => !node.disabled);
  if (activeNodes.length === 0) {
    return fail({ code: 'GRAPH_EMPTY', message: 'El flujo no tiene nodos activos.', retryable: false });
  }

  const nodesById = new Map<string, GraphNode>(options.graph.nodes.map((node) => [node.id, node]));
  const edgesBySource = new Map<string, GraphEdge[]>();
  for (const edge of options.graph.edges) {
    const list = edgesBySource.get(edge.source) ?? [];
    list.push(edge);
    edgesBySource.set(edge.source, list);
  }

  const trigger = activeNodes.find((node) => isTriggerDef(node.type));
  if (!trigger) {
    return fail({ code: 'NO_TRIGGER', message: 'El flujo no tiene disparador activo.', retryable: false });
  }

  // 2. Recorrido desde el trigger
  const queue: { nodeId: string; input: unknown }[] = [{ nodeId: trigger.id, input: context.trigger }];
  const executed = new Set<string>();
  let order = 0;
  let finalOutput: unknown;

  while (queue.length > 0) {
    if (options.signal?.aborted) {
      return fail(
        { code: 'CANCELLED', message: 'Ejecución cancelada por el usuario.', retryable: false },
        'CANCELLED',
      );
    }
    if (Date.now() - startedAtMs > limits.maxDurationMs) {
      return fail(
        {
          code: 'EXECUTION_TIMEOUT',
          message: `La ejecución superó el máximo de ${limits.maxDurationMs} ms.`,
          retryable: false,
        },
        'TIMED_OUT',
      );
    }
    if (order >= limits.maxSteps) {
      return fail({
        code: 'MAX_STEPS_EXCEEDED',
        message: `La ejecución superó el máximo de ${limits.maxSteps} pasos (¿ciclo?).`,
        retryable: false,
      });
    }

    const { nodeId, input } = queue.shift() as { nodeId: string; input: unknown };
    // Nodos de combinación: se ejecutan una sola vez (la primera llegada gana)
    if (executed.has(nodeId)) continue;
    executed.add(nodeId);

    const node = nodesById.get(nodeId);
    if (!node) continue;

    const enqueueNext = (byPort: Record<string, unknown> | null, defaultOutput: unknown) => {
      for (const edge of edgesBySource.get(nodeId) ?? []) {
        if (byPort) {
          if (Object.prototype.hasOwnProperty.call(byPort, edge.sourcePort)) {
            queue.push({ nodeId: edge.target, input: byPort[edge.sourcePort] });
          }
        } else {
          queue.push({ nodeId: edge.target, input: defaultOutput });
        }
      }
    };

    // Nodo desactivado: se saltea propagando la entrada
    if (node.disabled) {
      const step: StepRecord = {
        nodeId,
        nodeType: node.type,
        nodeVersion: node.nodeVersion,
        nodeName: node.name,
        status: 'SKIPPED',
        input,
        output: input,
        attempt: 0,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        order: order++,
      };
      steps.push(step);
      await hooks.onStepFinish?.(step);
      enqueueNext(null, input);
      continue;
    }

    const definition = options.resolveDefinition(node.type, node.nodeVersion);
    if (!definition) {
      return fail({
        code: 'NODE_TYPE_UNKNOWN',
        message: `Tipo de nodo desconocido: ${node.type} v${node.nodeVersion}.`,
        nodeId,
        retryable: false,
      });
    }

    const policy = { ...DEFAULT_POLICY, timeoutMs: limits.defaultNodeTimeoutMs, ...node.errorPolicy };
    const stepStartedAt = Date.now();
    const step: StepRecord = {
      nodeId,
      nodeType: node.type,
      nodeVersion: node.nodeVersion,
      nodeName: node.name,
      status: 'RUNNING',
      input,
      output: undefined,
      attempt: 1,
      startedAt: new Date(stepStartedAt).toISOString(),
      order: order++,
    };
    steps.push(step);
    await hooks.onStepStart?.(step);

    const logger: NodeLogger = {
      debug: (message, data) => void hooks.onLog?.({ nodeId, level: 'DEBUG', message, data }),
      info: (message, data) => void hooks.onLog?.({ nodeId, level: 'INFO', message, data }),
      warn: (message, data) => void hooks.onLog?.({ nodeId, level: 'WARN', message, data }),
      error: (message, data) => void hooks.onLog?.({ nodeId, level: 'ERROR', message, data }),
    };

    // Ejecutar con reintentos + timeout
    let lastError: WorkflowError | null = null;
    let result: {
      output?: unknown;
      outputsByPort?: Record<string, unknown>;
      variables?: Record<string, unknown>;
    } | null = null;
    const maxAttempts = policy.strategy === 'retry' ? policy.retries + 1 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      step.attempt = attempt;
      // El timeout del nodo nunca supera el presupuesto global restante
      const remainingMs = limits.maxDurationMs - (Date.now() - startedAtMs);
      if (remainingMs <= 0) {
        lastError = {
          code: 'EXECUTION_TIMEOUT',
          message: `La ejecución superó el máximo de ${limits.maxDurationMs} ms.`,
          nodeId,
          retryable: false,
        };
        break;
      }
      try {
        // Resolver expresiones y validar config en cada intento
        const exprContext = {
          trigger: context.trigger,
          nodes: Object.fromEntries(
            Object.entries(context.nodeOutputs).map(([id, output]) => [id, { output }]),
          ),
          variables: context.variables,
          environment: context.environment,
          execution: { startedAt: context.startedAt, id: context.executionId },
          input,
        };
        const resolvedConfig = definition.configSchema.parse(resolveDeep(node.config, exprContext));
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        options.signal?.addEventListener('abort', onAbort, { once: true });
        try {
          result = (await withTimeout(
            definition.execute({
              config: resolvedConfig as never,
              input: input as never,
              nodeId,
              executionId: context.executionId,
              logger,
              signal: controller.signal,
              services: options.services ?? {},
            }),
            Math.min(policy.timeoutMs, remainingMs),
            options.signal ?? controller.signal,
          )) as { output?: unknown; outputsByPort?: Record<string, unknown> };
        } finally {
          options.signal?.removeEventListener('abort', onAbort);
        }
        lastError = null;
        break;
      } catch (error) {
        lastError = toWorkflowError(error, nodeId);
        if (options.signal?.aborted) break;
        if (attempt < maxAttempts) {
          const delay =
            policy.backoff === 'exponential'
              ? policy.retryDelayMs * 2 ** (attempt - 1)
              : policy.retryDelayMs;
          logger.warn(`Intento ${attempt} falló (${lastError.code}); reintento en ${delay} ms`);
          try {
            await sleep(delay, options.signal);
          } catch {
            break;
          }
        }
      }
    }

    const finishStep = async (status: StepStatus, output: unknown, error?: WorkflowError) => {
      step.status = status;
      step.output = output;
      step.error = error;
      step.finishedAt = new Date().toISOString();
      step.durationMs = Date.now() - stepStartedAt;
      await hooks.onStepFinish?.(step);
    };

    if (options.signal?.aborted) {
      await finishStep('CANCELLED', undefined, lastError ?? undefined);
      return fail(
        { code: 'CANCELLED', message: 'Ejecución cancelada por el usuario.', nodeId, retryable: false },
        'CANCELLED',
      );
    }

    if (lastError) {
      // Presupuesto global agotado: el estado de la ejecución es TIMED_OUT
      if (
        lastError.code === 'EXECUTION_TIMEOUT' ||
        (lastError.code === 'NODE_TIMEOUT' && Date.now() - startedAtMs >= limits.maxDurationMs)
      ) {
        await finishStep('FAILED', undefined, lastError);
        return fail(
          {
            code: 'EXECUTION_TIMEOUT',
            message: `La ejecución superó el máximo de ${limits.maxDurationMs} ms.`,
            nodeId,
            retryable: false,
          },
          'TIMED_OUT',
        );
      }
      switch (policy.strategy) {
        case 'continue': {
          await finishStep('FAILED', input, lastError);
          logger.warn('Nodo falló; el flujo continúa con la entrada original (estrategia "continue")');
          context.nodeOutputs[nodeId] = input;
          enqueueNext(null, input);
          continue;
        }
        case 'fallback': {
          const fallback = node.errorPolicy?.fallbackValue;
          await finishStep('FAILED', fallback, lastError);
          logger.warn('Nodo falló; se usa el valor alternativo (estrategia "fallback")');
          context.nodeOutputs[nodeId] = fallback;
          enqueueNext(null, fallback);
          continue;
        }
        case 'error-output': {
          const errorEdges = (edgesBySource.get(nodeId) ?? []).filter((edge) => edge.sourcePort === 'error');
          await finishStep('FAILED', undefined, lastError);
          if (errorEdges.length > 0) {
            const payload = { error: { code: lastError.code, message: lastError.message } };
            context.nodeOutputs[nodeId] = payload;
            for (const edge of errorEdges) queue.push({ nodeId: edge.target, input: payload });
            continue;
          }
          return fail(lastError);
        }
        case 'stop':
        case 'retry':
        default: {
          await finishStep('FAILED', undefined, lastError);
          return fail(lastError);
        }
      }
    }

    // Éxito
    const outputsByPort = result && 'outputsByPort' in result && result.outputsByPort ? result.outputsByPort : null;
    const output = outputsByPort ?? (result ? result.output : undefined);
    context.nodeOutputs[nodeId] = output;
    // Variables declaradas por el nodo (p.ej. "Establecer variable")
    if (result?.variables) {
      Object.assign(context.variables, result.variables);
    }
    // {{trigger.*}} expone la salida normalizada del disparador
    if (definition.category === 'trigger' && output && typeof output === 'object' && !Array.isArray(output)) {
      context.trigger = output as Record<string, unknown>;
    }
    await finishStep('SUCCEEDED', output);

    const outgoing = edgesBySource.get(nodeId) ?? [];
    if (outgoing.length === 0) finalOutput = output;
    enqueueNext(outputsByPort, output);
  }

  return { status: 'SUCCEEDED', steps, context, finalOutput };
}
