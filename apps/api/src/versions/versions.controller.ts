import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { VersionsService } from './versions.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const publishSchema = z.object({
  description: z.string().max(500).optional(),
  markStable: z.boolean().optional().default(false),
});
const compareQuerySchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class VersionsController {
  constructor(private readonly versions: VersionsService) {}

  @Get('workflows/:workflowId/versions')
  @RequirePermission('versions.read')
  list(@Param('workflowId') workflowId: string) {
    return this.versions.listByWorkflow(workflowId);
  }

  @Post('workflows/:workflowId/versions')
  @HttpCode(201)
  @RequirePermission('versions.write')
  publish(
    @Param('workflowId') workflowId: string,
    @Body(new ZodValidationPipe(publishSchema)) body: z.infer<typeof publishSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.versions.publish(workflowId, body, request.user);
  }

  @Get('workflows/:workflowId/versions/compare')
  @RequirePermission('versions.read')
  compare(@Query(new ZodValidationPipe(compareQuerySchema)) query: z.infer<typeof compareQuerySchema>) {
    return this.versions.compare(query.from, query.to);
  }

  @Get('versions/:id')
  @RequirePermission('versions.read')
  get(@Param('id') id: string) {
    return this.versions.get(id);
  }

  @Post('versions/:id/stable')
  @HttpCode(200)
  @RequirePermission('versions.write')
  markStable(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.versions.markStable(id, request.user);
  }

  @Post('versions/:id/restore')
  @HttpCode(200)
  @RequirePermission('versions.write')
  restore(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.versions.restore(id, request.user);
  }
}
