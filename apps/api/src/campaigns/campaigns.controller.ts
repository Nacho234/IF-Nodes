import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { User } from '@ifnodes/database';
import { z } from 'zod';
import { CampaignsService } from './campaigns.service';
import { CurrentUser, PermissionsGuard, RequirePermission, SessionGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const runSchema = z.object({
  workflowId: z.string().min(1),
  status: z.string().max(60).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  staggerMs: z.number().int().min(0).max(60_000).optional(),
});
type RunBody = z.infer<typeof runSchema>;

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('projects/:projectId/campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  /** Cuántos contactos matchean el filtro (para revisar antes de lanzar). */
  @Get('preview')
  @RequirePermission('executions.read')
  preview(
    @Param('projectId') projectId: string,
    @Query('status') status?: string,
    @Query('tags') tags?: string,
  ) {
    const tagList = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    return this.campaigns.preview(projectId, status, tagList);
  }

  /** Lanza la campaña: una ejecución por contacto (escalonadas). */
  @Post('run')
  @RequirePermission('executions.run')
  run(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(runSchema)) body: RunBody,
    @CurrentUser() user: User,
  ) {
    return this.campaigns.run(projectId, body, user);
  }
}
