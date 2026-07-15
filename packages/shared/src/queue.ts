/** Contratos de la cola de ejecuciones (API productor ↔ worker consumidor). */
export const EXECUTIONS_QUEUE = 'executions';

export interface ExecutionJobData {
  executionId: string;
}

/**
 * Cola de disparos programados (cron). El worker mantiene un "job scheduler"
 * de BullMQ por flujo que tenga un nodo trigger.schedule; al dispararse, crea
 * y encola una ejecución. Ver apps/worker/src/scheduler.ts.
 */
export const SCHEDULES_QUEUE = 'schedules';

export interface ScheduleJobData {
  workflowId: string;
  /** Si está, en cada disparo corre este flujo UNA VEZ POR CONTACTO (campaña). */
  campaignWorkflowId?: string;
  /** Filtro de contactos por estado para la campaña programada. */
  campaignStatus?: string;
}

/**
 * Opciones de conexión Redis para BullMQ a partir de REDIS_URL.
 * Se pasan opciones planas (no una instancia) para evitar acoplar
 * la versión de ioredis de cada consumidor.
 */
export function redisConnectionFromUrl(redisUrl: string): {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: null;
} {
  const url = new URL(redisUrl);
  return {
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 6379,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : undefined,
    maxRetriesPerRequest: null,
  };
}

/** Límites duros del motor en el builder (ver SECURITY.md) */
export const ENGINE_LIMITS = {
  maxSteps: 200,
  maxDurationMs: 60_000,
  defaultNodeTimeoutMs: 30_000,
} as const;
