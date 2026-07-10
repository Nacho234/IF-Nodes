import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { EXECUTION_STATUSES } from '@ifnodes/shared';
import { z } from 'zod';
import { ExecutionsService } from './executions.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const runSchema = z.object({
  input: z.record(z.string(), z.unknown()).optional(),
});

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  workflowId: z.string().optional(),
  status: z.enum(EXECUTION_STATUSES).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});

@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class ExecutionsController {
  constructor(private readonly executions: ExecutionsService) {}

  @Post('workflows/:id/run')
  @HttpCode(202)
  @RequirePermission('executions.run')
  run(
    @Param('id') workflowId: string,
    @Body(new ZodValidationPipe(runSchema)) body: z.infer<typeof runSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.executions.runDraft(workflowId, body.input, request.user);
  }

  @Post('executions/:id/retry')
  @HttpCode(202)
  @RequirePermission('executions.run')
  retry(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.executions.retry(id, request.user);
  }

  @Get('executions')
  @RequirePermission('executions.read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.executions.list(query);
  }

  @Get('executions/:id')
  @RequirePermission('executions.read')
  get(@Param('id') id: string) {
    return this.executions.get(id);
  }
}
