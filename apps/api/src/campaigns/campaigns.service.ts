import { Injectable, NotFoundException, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { User } from '@ifnodes/database';
import { EXECUTIONS_QUEUE, redisConnectionFromUrl, type ExecutionJobData } from '@ifnodes/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';

export interface RunCampaignInput {
  workflowId: string;
  status?: string;
  tags?: string[];
  limit?: number;
  /** Milisegundos entre cada contacto, para no saturar el canal. */
  staggerMs?: number;
}

const MAX_CONTACTS = 1000;
const DEFAULT_STAGGER_MS = 1000;

/**
 * Motor de campañas (fan-out): corre un flujo UNA VEZ POR CONTACTO. Consulta los
 * contactos por filtro y encola una ejecución por cada uno, escalonadas para
 * controlar el ritmo. Cada contacto es una ejecución independiente (source
 * CAMPAIGN), con el contacto como disparo.
 */
@Injectable()
export class CampaignsService implements OnModuleDestroy {
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

  /** Vista previa: cuántos contactos matchean el filtro (sin lanzar nada). */
  async preview(projectId: string, status?: string, tags?: string[]): Promise<{ count: number }> {
    const count = await this.prisma.client.contact.count({
      where: {
        projectId,
        ...(status ? { status } : {}),
        ...(tags && tags.length > 0 ? { tags: { hasSome: tags } } : {}),
      },
    });
    return { count };
  }

  async run(projectId: string, input: RunCampaignInput, user: User): Promise<{ launched: number }> {
    const workflow = await this.prisma.client.workflow.findFirst({
      where: { id: input.workflowId, projectId },
      select: { id: true },
    });
    if (!workflow) throw new NotFoundException('Flujo no encontrado en este proyecto.');

    const contacts = await this.prisma.client.contact.findMany({
      where: {
        projectId,
        ...(input.status ? { status: input.status } : {}),
        ...(input.tags && input.tags.length > 0 ? { tags: { hasSome: input.tags } } : {}),
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.min(input.limit ?? MAX_CONTACTS, MAX_CONTACTS),
    });

    const stagger = Math.max(0, input.staggerMs ?? DEFAULT_STAGGER_MS);
    let launched = 0;
    for (const [index, contact] of contacts.entries()) {
      const execution = await this.prisma.client.execution.create({
        data: {
          projectId,
          workflowId: workflow.id,
          status: 'QUEUED',
          source: 'CAMPAIGN',
          environment: 'PRODUCTION',
          triggerType: 'trigger.campaign-contact',
          triggerData: {
            contactId: contact.id,
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            status: contact.status,
            tags: contact.tags,
          },
        },
      });
      await this.queue.add(
        'run',
        { executionId: execution.id },
        { jobId: execution.id, delay: index * stagger, removeOnComplete: 1000, removeOnFail: 1000 },
      );
      launched += 1;
    }

    await this.audit.log({
      userId: user.id,
      action: 'campaign.launched',
      entityType: 'workflow',
      entityId: workflow.id,
      detail: { projectId, launched, status: input.status ?? null, staggerMs: stagger },
    });

    return { launched };
  }
}
