/**
 * Worker de ejecuciones: consume la cola BullMQ, ejecuta el flujo con
 * workflow-core y persiste pasos/logs. Las ejecuciones NUNCA corren
 * dentro del proceso HTTP de la API.
 */
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
loadDotenv({ path: resolve(__dirname, '../../../.env') });
loadDotenv();

import { Worker, type Job } from 'bullmq';
import { prisma, type Prisma } from '@ifnodes/database';
import { nodeRegistry } from '@ifnodes/node-definitions';
import {
  ENGINE_LIMITS,
  EXECUTIONS_QUEUE,
  redactSecrets,
  redisConnectionFromUrl,
  workflowGraphSchema,
  type ExecutionJobData,
} from '@ifnodes/shared';
import { executeWorkflow, type StepRecord } from '@ifnodes/workflow-core';
import { buildServices } from './services';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

function log(level: 'info' | 'warn' | 'error', message: string, data: Record<string, unknown> = {}) {
  // Log estructurado JSON: consumible por cualquier agregador
  console.log(JSON.stringify({ level, message, ts: new Date().toISOString(), ...data }));
}

async function processExecution(job: Job<ExecutionJobData>): Promise<void> {
  const { executionId } = job.data;
  const execution = await prisma.execution.findUnique({
    where: { id: executionId },
    include: { workflow: true, version: true },
  });
  if (!execution) {
    log('warn', 'Ejecución inexistente', { executionId });
    return;
  }
  // Idempotencia: si otro worker ya la procesó, no repetir
  if (execution.status !== 'QUEUED') {
    log('warn', 'Ejecución ya procesada; se ignora el job duplicado', {
      executionId,
      status: execution.status,
    });
    return;
  }

  // La versión publicada manda; si no hay (prueba de borrador), va el draft
  const rawGraph = execution.version?.graph ?? execution.workflow.draftGraph;
  const graph = workflowGraphSchema.parse(rawGraph);

  // Variables del entorno del proyecto (solo valores no secretos por ahora; Fase 7 descifra)
  const environmentRow = await prisma.environment.findUnique({
    where: {
      projectId_kind: {
        projectId: execution.projectId,
        kind: execution.environment as never,
      },
    },
    include: { variables: true },
  });
  const environment: Record<string, unknown> = {};
  for (const variable of environmentRow?.variables ?? []) {
    if (!variable.secret && variable.value !== null) environment[variable.key] = variable.value;
  }

  await prisma.execution.update({
    where: { id: executionId },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  const stepIds = new Map<string, string>();
  const startedAtMs = Date.now();

  // Servicios inyectados (HTTP con SSRF, IA); nodeIdRef atribuye el uso al nodo en curso
  const nodeIdRef = { current: '' };
  const services = buildServices(
    { prisma, projectId: execution.projectId, executionId },
    nodeIdRef,
  );

  const result = await executeWorkflow({
    graph,
    ids: {
      executionId,
      projectId: execution.projectId,
      workflowId: execution.workflowId,
      versionId: execution.versionId,
    },
    trigger: (execution.triggerData as Record<string, unknown> | null) ?? {},
    environment,
    services,
    resolveDefinition: (type, version) => nodeRegistry.get(type, version),
    limits: ENGINE_LIMITS,
    hooks: {
      async onStepStart(step: StepRecord) {
        nodeIdRef.current = step.nodeId;
        const row = await prisma.executionStep.create({
          data: {
            executionId,
            nodeId: step.nodeId,
            nodeType: step.nodeType,
            nodeVersion: step.nodeVersion,
            nodeName: step.nodeName,
            status: 'RUNNING',
            input: redactSecrets(step.input) as Prisma.InputJsonValue,
            attempt: step.attempt,
            startedAt: new Date(step.startedAt),
            order: step.order,
          },
        });
        stepIds.set(`${step.nodeId}:${step.order}`, row.id);
      },
      async onStepFinish(step: StepRecord) {
        const key = `${step.nodeId}:${step.order}`;
        const existingId = stepIds.get(key);
        const data = {
          status: step.status,
          input: redactSecrets(step.input) as Prisma.InputJsonValue,
          output: redactSecrets(step.output) as Prisma.InputJsonValue,
          error: step.error ? (redactSecrets({ ...step.error, stack: undefined }) as Prisma.InputJsonValue) : undefined,
          attempt: step.attempt,
          finishedAt: step.finishedAt ? new Date(step.finishedAt) : new Date(),
          durationMs: step.durationMs ?? 0,
        };
        if (existingId) {
          await prisma.executionStep.update({ where: { id: existingId }, data });
        } else {
          // Pasos SKIPPED no pasan por onStepStart
          await prisma.executionStep.create({
            data: {
              executionId,
              nodeId: step.nodeId,
              nodeType: step.nodeType,
              nodeVersion: step.nodeVersion,
              nodeName: step.nodeName,
              startedAt: new Date(step.startedAt),
              order: step.order,
              ...data,
            },
          });
        }
      },
      async onLog(entry) {
        await prisma.executionLog.create({
          data: {
            executionId,
            nodeId: entry.nodeId,
            level: entry.level,
            message: entry.message.slice(0, 2000),
            data: entry.data ? (redactSecrets(entry.data) as Prisma.InputJsonValue) : undefined,
          },
        });
      },
    },
  });

  await prisma.execution.update({
    where: { id: executionId },
    data: {
      status: result.status,
      error: result.error ? (redactSecrets({ ...result.error, stack: undefined }) as Prisma.InputJsonValue) : undefined,
      failedNodeId: result.failedNodeId,
      context: redactSecrets({
        variables: result.context.variables,
        nodeOutputs: result.context.nodeOutputs,
        finalOutput: result.finalOutput,
      }) as Prisma.InputJsonValue,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAtMs,
    },
  });

  log('info', 'Ejecución finalizada', {
    executionId,
    status: result.status,
    steps: result.steps.length,
    durationMs: Date.now() - startedAtMs,
  });
}

async function main() {
  const worker = new Worker<ExecutionJobData>(EXECUTIONS_QUEUE, processExecution, {
    connection: redisConnectionFromUrl(REDIS_URL),
    concurrency: 5,
  });

  worker.on('failed', async (job, error) => {
    log('error', 'Job de ejecución falló', { executionId: job?.data.executionId, error: error.message });
    // Falla de infraestructura (no del flujo): marcar la ejecución como FAILED
    if (job?.data.executionId) {
      await prisma.execution
        .updateMany({
          where: { id: job.data.executionId, status: { in: ['QUEUED', 'RUNNING'] } },
          data: {
            status: 'FAILED',
            error: { code: 'WORKER_ERROR', message: error.message, retryable: true },
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
  });

  worker.on('ready', () => log('info', `Worker escuchando la cola "${EXECUTIONS_QUEUE}"`));

  const shutdown = async () => {
    log('info', 'Apagando worker…');
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main();
