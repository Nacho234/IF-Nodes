import { Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { workflowGraphSchema, type WorkflowGraph } from '@ifnodes/shared';
import { z } from 'zod';
import { WorkflowsService } from './workflows.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const saveDraftSchema = z.object({ graph: workflowGraphSchema });

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get(':id')
  @RequirePermission('workflows.read')
  get(@Param('id') id: string) {
    return this.workflows.get(id);
  }

  /** Guarda el borrador. El grafo se valida con Zod; la estructura devuelve issues. */
  @Put(':id/draft')
  @RequirePermission('workflows.write')
  saveDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveDraftSchema)) body: { graph: WorkflowGraph },
    @Req() request: AuthenticatedRequest,
  ) {
    return this.workflows.saveDraft(id, body.graph, request.user);
  }

  @Get(':id/validate')
  @RequirePermission('workflows.read')
  validate(@Param('id') id: string) {
    return this.workflows.validate(id);
  }
}
