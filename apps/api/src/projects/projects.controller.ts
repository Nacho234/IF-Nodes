import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  PROJECT_STATUSES,
  createProjectSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type UpdateProjectInput,
} from '@ifnodes/shared';
import { z } from 'zod';
import { ProjectsService } from './projects.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  clientId: z.string().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
});

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('projects.read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.projects.list(query);
  }

  @Get(':id')
  @RequirePermission('projects.read')
  get(@Param('id') id: string) {
    return this.projects.get(id);
  }

  @Post()
  @RequirePermission('projects.write')
  create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.projects.create(body, request.user);
  }

  @Patch(':id')
  @RequirePermission('projects.write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.projects.update(id, body, request.user);
  }

  @Delete(':id')
  @RequirePermission('projects.write')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.projects.remove(id, request.user);
  }
}
