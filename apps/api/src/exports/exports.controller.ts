import { createReadStream } from 'node:fs';
import { Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { ExportsService } from './exports.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const generateQuerySchema = z.object({ versionId: z.string().optional() });

@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get('exports')
  @RequirePermission('exports.read')
  listRecent() {
    return this.exports.listRecent();
  }

  @Get('projects/:projectId/exports')
  @RequirePermission('exports.read')
  list(@Param('projectId') projectId: string) {
    return this.exports.listByProject(projectId);
  }

  @Post('workflows/:workflowId/export')
  @HttpCode(201)
  @RequirePermission('exports.create')
  generate(
    @Param('workflowId') workflowId: string,
    @Query(new ZodValidationPipe(generateQuerySchema)) query: z.infer<typeof generateQuerySchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.exports.generate(workflowId, query.versionId, request.user);
  }

  @Post('projects/:projectId/export')
  @HttpCode(201)
  @RequirePermission('exports.create')
  generateProject(@Param('projectId') projectId: string, @Req() request: AuthenticatedRequest) {
    return this.exports.generateProject(projectId, request.user);
  }

  @Get('exports/:id/download')
  @RequirePermission('exports.read')
  async download(@Param('id') id: string, @Res() res: Response) {
    const { path, slug } = await this.exports.getDownloadPath(id);
    res.setHeader('content-type', 'application/zip');
    res.setHeader('content-disposition', `attachment; filename="${slug}"`);
    createReadStream(path).pipe(res);
  }
}
