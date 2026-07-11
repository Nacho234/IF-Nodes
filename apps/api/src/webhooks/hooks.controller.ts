import {
  Body,
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Prisma } from '@ifnodes/database';
import { redactSecrets, workflowGraphSchema, validateGraphStructure } from '@ifnodes/shared';
import { nodeRegistry } from '@ifnodes/node-definitions';
import { PrismaService } from '../common/prisma.service';
import { ExecutionsService } from '../executions/executions.service';

/**
 * Entrada pública de webhooks (sin sesión: autentica el token no adivinable
 * de la URL). Responde 202 con el id de ejecución; la respuesta síncrona
 * llega con el nodo "Responder webhook" en Fase 7.
 */
@Controller('hooks')
export class HooksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executions: ExecutionsService,
  ) {}

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(':token')
  @HttpCode(202)
  async receive(@Param('token') token: string, @Body() body: unknown) {
    const workflow = await this.prisma.client.workflow.findUnique({
      where: { webhookToken: token },
      select: { id: true, projectId: true, draftGraph: true },
    });
    // 404 genérico: no revelar si el token existe parcialmente
    if (!workflow) throw new NotFoundException('Webhook desconocido.');

    const graph = workflowGraphSchema.parse(workflow.draftGraph);
    const trigger = graph.nodes.find((node) => !node.disabled && nodeRegistry.isTrigger(node.type));
    const errors = validateGraphStructure(graph, (type) => nodeRegistry.isTrigger(type)).filter(
      (issue) => issue.level === 'error',
    );
    if (!trigger || errors.length > 0) {
      throw new NotFoundException('El flujo de este webhook no está listo para ejecutarse.');
    }

    const payload =
      body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : { body };

    const execution = await this.prisma.client.execution.create({
      data: {
        projectId: workflow.projectId,
        workflowId: workflow.id,
        status: 'QUEUED',
        source: 'WEBHOOK',
        environment: 'DEVELOPMENT',
        triggerType: trigger.type,
        triggerData: redactSecrets(payload) as Prisma.InputJsonValue,
      },
    });
    await this.executions.enqueueExisting(execution.id);
    return { executionId: execution.id, status: 'queued' };
  }
}
