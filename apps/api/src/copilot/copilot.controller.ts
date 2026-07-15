import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { User } from '@ifnodes/database';
import { z } from 'zod';
import { CopilotService } from './copilot.service';
import {
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  SessionGuard,
} from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const chatBodySchema = z.object({
  content: z.string().min(1, 'Escribí un mensaje.').max(8000),
  selectedNodeId: z.string().max(64).optional(),
});
type ChatBody = z.infer<typeof chatBodySchema>;

const buildBodySchema = z.object({
  description: z.string().min(1, 'Describí el agente a armar.').max(8000),
});
type BuildBody = z.infer<typeof buildBodySchema>;

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('copilot')
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  @Get('config')
  @RequirePermission('copilot.use')
  config() {
    return this.copilot.config();
  }

  /** Fase 3: arma un proyecto entero (varios flujos + conocimiento) de un pedido. */
  @Post('projects/:projectId/build')
  @RequirePermission('workflows.write')
  build(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(buildBodySchema)) body: BuildBody,
    @CurrentUser() user: User,
  ) {
    return this.copilot.buildProject(projectId, body.description, user);
  }

  /** Devuelve (o crea) la sesión del flujo con su historial. */
  @Get('sessions')
  @RequirePermission('copilot.use')
  getSession(@Query('workflowId') workflowId: string, @CurrentUser() user: User) {
    return this.copilot.getOrCreateSession(workflowId, user);
  }

  /** Nuevo chat: limpia el historial de la sesión. */
  @Post('sessions/:id/reset')
  @RequirePermission('copilot.use')
  reset(@Param('id') id: string) {
    return this.copilot.resetSession(id);
  }

  /** Turno de chat con streaming SSE (Server-Sent Events). */
  @Post('sessions/:id/messages')
  @RequirePermission('copilot.use')
  async chat(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(chatBodySchema)) body: ChatBody,
    @CurrentUser() user: User,
    @Res() res: Response,
  ): Promise<void> {
    await this.copilot.chatStream(
      { sessionId: id, content: body.content, selectedNodeId: body.selectedNodeId },
      user,
      res,
    );
  }
}
