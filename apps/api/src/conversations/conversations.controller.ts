import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { PermissionsGuard, RequirePermission, SessionGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../common/prisma.service';

const statusSchema = z.object({ status: z.enum(['open', 'handoff', 'closed']) });
type StatusBody = z.infer<typeof statusSchema>;

/** Bandeja de operador: conversaciones (por defecto en handoff) y su historial. */
@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class ConversationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('projects/:projectId/conversations')
  @RequirePermission('executions.read')
  list(@Param('projectId') projectId: string, @Query('status') status?: string) {
    return this.prisma.client.conversation.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      orderBy: { lastMessageAt: 'desc' },
      take: 300,
      include: { _count: { select: { messages: true } } },
    });
  }

  @Get('conversations/:id/messages')
  @RequirePermission('executions.read')
  messages(@Param('id') id: string) {
    return this.prisma.client.conversationMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }

  /** El operador cambia el estado (p.ej. cerrar, o devolver al bot). */
  @Patch('conversations/:id/status')
  @RequirePermission('executions.run')
  async setStatus(@Param('id') id: string, @Body(new ZodValidationPipe(statusSchema)) body: StatusBody) {
    await this.prisma.client.conversation.update({ where: { id }, data: { status: body.status } });
    return { ok: true };
  }
}
