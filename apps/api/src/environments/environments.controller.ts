import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ENVIRONMENT_KINDS } from '@ifnodes/shared';
import { z } from 'zod';
import { EnvironmentsService } from './environments.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const createSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(5000).default(''),
  secret: z.boolean().default(false),
});
const updateSchema = z.object({
  value: z.string().max(5000).optional(),
  secret: z.boolean().optional(),
});

// Las variables de entorno se tratan como credenciales a nivel de permisos
@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get('projects/:projectId/environments')
  @RequirePermission('credentials.read')
  list(@Param('projectId') projectId: string) {
    return this.environments.listByProject(projectId);
  }

  @Post('projects/:projectId/environments/:kind/variables')
  @RequirePermission('credentials.write')
  create(
    @Param('projectId') projectId: string,
    @Param('kind') kind: string,
    @Body(new ZodValidationPipe(createSchema)) body: z.infer<typeof createSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const parsedKind = ENVIRONMENT_KINDS.find((k) => k === kind) ?? 'DEVELOPMENT';
    return this.environments.createVariable(projectId, parsedKind, body, request.user);
  }

  @Patch('environment-variables/:id')
  @RequirePermission('credentials.write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.environments.updateVariable(id, body, request.user);
  }

  @Delete('environment-variables/:id')
  @RequirePermission('credentials.write')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.environments.deleteVariable(id, request.user);
  }
}
