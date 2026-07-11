import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type User } from '@ifnodes/database';
import {
  evaluateAssertions,
  redactSecrets,
  testAssertionsSchema,
  type AssertionResult,
  type CreateTestCaseInput,
  type UpdateTestCaseInput,
} from '@ifnodes/shared';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ExecutionsService } from '../executions/executions.service';

@Injectable()
export class TestCasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly executions: ExecutionsService,
  ) {}

  async listByProject(projectId: string) {
    return this.prisma.client.testCase.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(projectId: string, input: CreateTestCaseInput, user: User) {
    const workflow = await this.prisma.client.workflow.findFirst({
      where: { id: input.workflowId, projectId },
      select: { id: true },
    });
    if (!workflow) throw new BadRequestException('El flujo no pertenece a este proyecto.');

    const testCase = await this.prisma.client.testCase.create({
      data: {
        projectId,
        workflowId: input.workflowId,
        name: input.name,
        description: input.description === '' ? null : input.description,
        triggerType: 'simulated',
        input: JSON.parse(input.inputJson) as Prisma.InputJsonValue,
        assertions: input.assertions as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'testcase.created',
      entityType: 'testcase',
      entityId: testCase.id,
      detail: { name: testCase.name, projectId },
    });
    return testCase;
  }

  async update(id: string, input: UpdateTestCaseInput, user: User) {
    await this.ensureExists(id);
    const testCase = await this.prisma.client.testCase.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description === '' ? null : input.description,
        workflowId: input.workflowId,
        input: input.inputJson ? (JSON.parse(input.inputJson) as Prisma.InputJsonValue) : undefined,
        assertions: input.assertions ? (input.assertions as unknown as Prisma.InputJsonValue) : undefined,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'testcase.updated',
      entityType: 'testcase',
      entityId: id,
      detail: { fields: Object.keys(input) },
    });
    return testCase;
  }

  async duplicate(id: string, user: User) {
    const original = await this.prisma.client.testCase.findUnique({ where: { id } });
    if (!original) throw new NotFoundException('Caso de prueba no encontrado.');
    const copy = await this.prisma.client.testCase.create({
      data: {
        projectId: original.projectId,
        workflowId: original.workflowId,
        name: `${original.name} (copia)`,
        description: original.description,
        triggerType: original.triggerType,
        input: original.input as Prisma.InputJsonValue,
        assertions: original.assertions as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'testcase.duplicated',
      entityType: 'testcase',
      entityId: copy.id,
      detail: { from: id },
    });
    return copy;
  }

  async remove(id: string, user: User) {
    await this.ensureExists(id);
    await this.prisma.client.testCase.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'testcase.deleted',
      entityType: 'testcase',
      entityId: id,
    });
    return { ok: true };
  }

  /** Lanza la ejecución del caso; el cliente pollea y después llama a evaluate. */
  async run(id: string, user: User) {
    const testCase = await this.prisma.client.testCase.findUnique({ where: { id } });
    if (!testCase) throw new NotFoundException('Caso de prueba no encontrado.');
    if (!testCase.workflowId) throw new BadRequestException('El caso no tiene flujo asociado.');

    const { executionId } = await this.executions.runDraft(
      testCase.workflowId,
      (testCase.input as Record<string, unknown> | null) ?? {},
      user,
      'TEST_CASE',
    );
    await this.prisma.client.testCase.update({
      where: { id },
      data: { lastRunAt: new Date(), lastRunStatus: 'RUNNING', lastRunDetail: Prisma.JsonNull },
    });
    return { executionId };
  }

  /** Evalúa las assertions del caso contra una ejecución terminada y persiste el resultado. */
  async evaluate(id: string, executionId: string, user: User) {
    const testCase = await this.prisma.client.testCase.findUnique({ where: { id } });
    if (!testCase) throw new NotFoundException('Caso de prueba no encontrado.');

    const execution = await this.prisma.client.execution.findUnique({
      where: { id: executionId },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
    if (!execution || execution.workflowId !== testCase.workflowId) {
      throw new BadRequestException('La ejecución no corresponde a este caso.');
    }
    if (['QUEUED', 'RUNNING', 'WAITING'].includes(execution.status)) {
      throw new BadRequestException('La ejecución todavía no terminó.');
    }

    const assertions = testAssertionsSchema.parse(testCase.assertions ?? []);
    const context = (execution.context ?? {}) as {
      nodeOutputs?: Record<string, unknown>;
      finalOutput?: unknown;
      variables?: Record<string, unknown>;
    };
    const results: AssertionResult[] = evaluateAssertions(assertions, {
      status: execution.status,
      finalOutput: context.finalOutput,
      nodeOutputs: context.nodeOutputs ?? {},
      visitedNodeIds: execution.steps
        .filter((step) => step.status !== 'SKIPPED')
        .map((step) => step.nodeId),
      variables: context.variables,
      trigger: execution.triggerData,
    });

    const passed = results.every((result) => result.passed) && execution.status === 'SUCCEEDED';
    const detail = {
      executionId,
      executionStatus: execution.status,
      results: redactSecrets(results),
    };
    await this.prisma.client.testCase.update({
      where: { id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: passed ? 'PASSED' : 'FAILED',
        lastRunDetail: detail as Prisma.InputJsonValue,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'testcase.evaluated',
      entityType: 'testcase',
      entityId: id,
      detail: { executionId, passed },
    });
    return { passed, executionStatus: execution.status, results };
  }

  private async ensureExists(id: string): Promise<void> {
    const exists = await this.prisma.client.testCase.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundException('Caso de prueba no encontrado.');
  }
}
