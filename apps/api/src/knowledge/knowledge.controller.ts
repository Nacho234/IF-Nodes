import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { KnowledgeService } from './knowledge.service';
import { PermissionsGuard, RequirePermission, SessionGuard } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const createSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.string().min(1, 'El contenido es obligatorio').max(50_000),
  tags: z.array(z.string().max(40)).max(20).optional(),
});
type CreateBody = z.infer<typeof createSchema>;

@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('projects/:projectId/knowledge')
  @RequirePermission('projects.read')
  list(@Param('projectId') projectId: string) {
    return this.knowledge.list(projectId);
  }

  @Post('projects/:projectId/knowledge')
  @RequirePermission('projects.write')
  create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createSchema)) body: CreateBody,
  ) {
    return this.knowledge.create(projectId, body);
  }

  @Delete('knowledge/:id')
  @RequirePermission('projects.write')
  remove(@Param('id') id: string) {
    return this.knowledge.remove(id);
  }
}
