import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { createTestCaseSchema, updateTestCaseSchema } from '@ifnodes/shared';
import { z } from 'zod';
import { TestCasesService } from './testcases.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const evaluateSchema = z.object({ executionId: z.string().min(1) });

@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class TestCasesController {
  constructor(private readonly testCases: TestCasesService) {}

  @Get('projects/:projectId/test-cases')
  @RequirePermission('testcases.read')
  list(@Param('projectId') projectId: string) {
    return this.testCases.listByProject(projectId);
  }

  @Post('projects/:projectId/test-cases')
  @RequirePermission('testcases.write')
  create(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createTestCaseSchema)) body: z.infer<typeof createTestCaseSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.testCases.create(projectId, body, request.user);
  }

  @Patch('test-cases/:id')
  @RequirePermission('testcases.write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTestCaseSchema)) body: z.infer<typeof updateTestCaseSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.testCases.update(id, body, request.user);
  }

  @Post('test-cases/:id/duplicate')
  @RequirePermission('testcases.write')
  duplicate(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.testCases.duplicate(id, request.user);
  }

  @Delete('test-cases/:id')
  @RequirePermission('testcases.write')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.testCases.remove(id, request.user);
  }

  @Post('test-cases/:id/run')
  @HttpCode(202)
  @RequirePermission('executions.run')
  run(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.testCases.run(id, request.user);
  }

  @Post('test-cases/:id/evaluate')
  @HttpCode(200)
  @RequirePermission('executions.run')
  evaluate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(evaluateSchema)) body: z.infer<typeof evaluateSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.testCases.evaluate(id, body.executionId, request.user);
  }
}
