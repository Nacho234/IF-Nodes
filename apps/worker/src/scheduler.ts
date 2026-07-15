/**
 * Scheduler de disparadores programados (cron). Mantiene un "job scheduler" de
 * BullMQ por cada flujo que tenga un nodo trigger.schedule activo; cuando se
 * dispara, crea y encola una ejecución (source SCHEDULE). Reconcilia al arrancar
 * y cada minuto, así se autocorrige ante cambios en los flujos.
 */
import { Queue, Worker, type Job } from 'bullmq';
import type { PrismaClient } from '@ifnodes/database';
import {
  EXECUTIONS_QUEUE,
  SCHEDULES_QUEUE,
  redisConnectionFromUrl,
  workflowGraphSchema,
  type ExecutionJobData,
  type ScheduleJobData,
} from '@ifnodes/shared';

const RECONCILE_INTERVAL_MS = 60_000;

interface ScheduleSpec {
  cron: string;
  timezone: string;
}

/** Extrae la config del primer nodo trigger.schedule activo del grafo (o null). */
export function extractSchedule(rawGraph: unknown): ScheduleSpec | null {
  const parsed = workflowGraphSchema.safeParse(rawGraph);
  if (!parsed.success) return null;
  const node = parsed.data.nodes.find((n) => n.type === 'trigger.schedule' && !n.disabled);
  if (!node) return null;
  const cron = typeof node.config.cron === 'string' ? node.config.cron.trim() : '';
  if (!cron) return null;
  const timezone = typeof node.config.timezone === 'string' && node.config.timezone ? node.config.timezone : 'UTC';
  return { cron, timezone };
}

function schedulerId(workflowId: string): string {
  return `wf:${workflowId}`;
}

export function startScheduler(
  prisma: PrismaClient,
  redisUrl: string,
  log: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void,
): { stop: () => Promise<void> } {
  const connection = redisConnectionFromUrl(redisUrl);
  const schedulesQueue = new Queue<ScheduleJobData>(SCHEDULES_QUEUE, { connection });
  const executionsQueue = new Queue<ExecutionJobData>(EXECUTIONS_QUEUE, { connection });

  // Consumidor: cada disparo del cron crea + encola una ejecución
  const worker = new Worker<ScheduleJobData>(
    SCHEDULES_QUEUE,
    async (job: Job<ScheduleJobData>) => {
      const { workflowId } = job.data;
      const workflow = await prisma.workflow.findUnique({ where: { id: workflowId }, select: { id: true, projectId: true } });
      if (!workflow) {
        log('warn', 'Schedule de un flujo inexistente; se ignora', { workflowId });
        return;
      }
      const execution = await prisma.execution.create({
        data: {
          projectId: workflow.projectId,
          workflowId: workflow.id,
          status: 'QUEUED',
          source: 'SCHEDULE',
          environment: 'PRODUCTION',
          triggerType: 'trigger.schedule',
          triggerData: { firedAt: new Date().toISOString() },
        },
      });
      await executionsQueue.add(
        'run',
        { executionId: execution.id },
        { jobId: execution.id, removeOnComplete: 1000, removeOnFail: 1000 },
      );
      log('info', 'Disparo programado encolado', { workflowId, executionId: execution.id });
    },
    { connection, concurrency: 5 },
  );

  const reconcile = async () => {
    try {
      const workflows = await prisma.workflow.findMany({ select: { id: true, draftGraph: true } });
      const desired = new Map<string, ScheduleSpec>();
      for (const wf of workflows) {
        const spec = extractSchedule(wf.draftGraph);
        if (spec) desired.set(wf.id, spec);
      }

      // Alta/actualización de los deseados
      for (const [workflowId, spec] of desired) {
        await schedulesQueue.upsertJobScheduler(
          schedulerId(workflowId),
          { pattern: spec.cron, tz: spec.timezone },
          { name: 'scheduled', data: { workflowId } },
        );
      }

      // Baja de los que ya no corresponden
      const existing = await schedulesQueue.getJobSchedulers(0, -1);
      for (const sched of existing) {
        const id = sched.key ?? sched.id;
        if (!id || !id.startsWith('wf:')) continue;
        const workflowId = id.slice(3);
        if (!desired.has(workflowId)) {
          await schedulesQueue.removeJobScheduler(id);
          log('info', 'Schedule removido (ya no aplica)', { workflowId });
        }
      }
      log('info', 'Schedules reconciliados', { activos: desired.size });
    } catch (error) {
      log('error', 'Fallo al reconciliar schedules', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  void reconcile();
  const interval = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);

  return {
    async stop() {
      clearInterval(interval);
      await worker.close();
      await schedulesQueue.close();
      await executionsQueue.close();
    },
  };
}
