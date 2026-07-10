/** Contratos de la cola de ejecuciones (API productor ↔ worker consumidor). */
export const EXECUTIONS_QUEUE = 'executions';

export interface ExecutionJobData {
  executionId: string;
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
