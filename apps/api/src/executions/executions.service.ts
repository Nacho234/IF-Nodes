import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import type { Prisma, User } from '@ifnodes/database';
import {
  EXECUTIONS_QUEUE,
  redactSecrets,
  redisConnectionFromUrl,
  validateGraphStructure,
  workflowGraphSchema,
  type ExecutionJobData,
  type ExecutionStatus,
} from '@ifnodes/shared';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';

@Injectable()
export class ExecutionsService implements OnModuleDestroy {
  private readonly logger = new Logger(ExecutionsService.name);
  private readonly queue: Queue<ExecutionJobData>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    const env = loadEnv();
    this.queue = new Queue<ExecutionJobData>(EXECUTIONS_QUEUE, {
      connection: redisConnectionFromUrl(env.REDIS_URL || 'redis://localhost:6379'),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close().catch(() => undefined);
  }

  /** Prueba manual del borrador: valida, crea la ejecución y la encola. */
  async runDraft(
    workflowId: string,
    input: Record<string, unknown> | undefined,
    user: User,
    source: 'MANUAL' | 'SIMULATOR' | 'TEST_CASE' = 'MANUAL',
  ) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { id: workflowId },
      select: { id: true, projectId: true, draftGraph: true },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado.');

    const graph = workflowGraphSchema.parse(workflow.draftGraph);
    const errors = validateGraphStructure(graph, (type) => nodeRegistry.isTrigger(type)).filter(
      (issue) => issue.level === 'error',
    );
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'El flujo tiene errores que impiden ejecutarlo.',
        issues: errors.map((issue) => ({ path: issue.nodeId ?? '', message: issue.message })),
      });
    }
    const trigger = graph.nodes.find((node) => !node.disabled && nodeRegistry.isTrigger(node.type));

    const execution = await this.prisma.client.execution.create({
      data: {
        projectId: workflow.projectId,
        workflowId: workflow.id,
        versionId: null, // prueba del borrador
        status: 'QUEUED',
        source,
        environment: 'DEVELOPMENT',
        triggerType: trigger?.type ?? 'trigger.manual',
        triggerData: (input ? redactSecrets(input) : undefined) as Prisma.InputJsonValue | undefined,
      },
    });

    await this.enqueue(execution.id);
    await this.audit.log({
      userId: user.id,
      action: 'execution.started',
      entityType: 'execution',
      entityId: execution.id,
      detail: { workflowId, source },
    });
    return { executionId: execution.id };
  }

  /** Reintenta una ejecución creando una nueva con el mismo disparador. */
  async retry(executionId: string, user: User) {
    const original = await this.prisma.client.execution.findUnique({ where: { id: executionId } });
    if (!original) throw new NotFoundException('Ejecución no encontrada.');

    const execution = await this.prisma.client.execution.create({
      data: {
        projectId: original.projectId,
        workflowId: original.workflowId,
        versionId: original.versionId,
        status: 'QUEUED',
        source: original.source,
        environment: original.environment,
        triggerType: original.triggerType,
        triggerData: original.triggerData as Prisma.InputJsonValue | undefined,
      },
    });
    await this.enqueue(execution.id);
    await this.audit.log({
      userId: user.id,
      action: 'execution.retried',
      entityType: 'execution',
      entityId: execution.id,
      detail: { originalExecutionId: executionId },
    });
    return { executionId: execution.id };
  }

  async list(filters: { projectId?: string; workflowId?: string; status?: ExecutionStatus; take: number }) {
    const where: Prisma.ExecutionWhereInput = {};
    if (filters.projectId) where.projectId = filters.projectId;
    if (filters.workflowId) where.workflowId = filters.workflowId;
    if (filters.status) where.status = filters.status;
    return this.prisma.client.execution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filters.take,
      include: {
        project: { select: { id: true, name: true, client: { select: { name: true } } } },
        workflow: { select: { id: true, name: true } },
        version: { select: { number: true } },
        _count: { select: { steps: true } },
      },
    });
  }

  async get(id: string) {
    const execution = await this.prisma.client.execution.findUnique({
      where: { id },
      include: {
        project: { select: { id: true, name: true } },
        workflow: { select: { id: true, name: true } },
        version: { select: { number: true } },
        steps: { orderBy: { order: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' }, take: 500 },
      },
    });
    if (!execution) throw new NotFoundException('Ejecución no encontrada.');
    return execution;
  }

  /** Encola una ejecución ya creada (usado por el endpoint público de webhooks). */
  async enqueueExisting(executionId: string): Promise<void> {
    return this.enqueue(executionId);
  }

  private async enqueue(executionId: string): Promise<void> {
    try {
      // jobId determinista = idempotencia: la misma ejecución no se encola dos veces
      await this.queue.add('run', { executionId }, { jobId: executionId, removeOnComplete: 1000, removeOnFail: 1000 });
    } catch (error) {
      this.logger.error(`No se pudo encolar la ejecución ${executionId}: ${String(error)}`);
      await this.prisma.client.execution.update({
        where: { id: executionId },
        data: {
          status: 'FAILED',
          error: { code: 'QUEUE_UNAVAILABLE', message: 'Redis no está disponible.', retryable: true },
          finishedAt: new Date(),
        },
      });
      throw new ServiceUnavailableException(
        'La cola de ejecuciones no está disponible (Redis). Levantá Redis y reintentá.',
      );
    }
  }
}
