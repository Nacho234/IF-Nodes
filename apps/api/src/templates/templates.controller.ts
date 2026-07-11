import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { STARTER_TEMPLATES, starterTemplate } from '@ifnodes/shared';
import type { Prisma } from '@ifnodes/database';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const useSchema = z.object({
  clientId: z.string().min(1, 'Seleccioná un cliente'),
  name: z.string().trim().min(1, 'El nombre es obligatorio').max(120),
});

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('templates')
export class TemplatesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Catálogo de plantillas iniciales (metadatos, sin el grafo completo). */
  @Get()
  @RequirePermission('projects.read')
  list() {
    return STARTER_TEMPLATES.map((t) => ({
      slug: t.slug,
      name: t.name,
      description: t.description,
      category: t.category,
      projectType: t.projectType,
      requiredIntegrations: t.requiredIntegrations,
      nodeCount: t.graph.nodes.length,
    }));
  }

  /** Crea un proyecto nuevo a partir de la plantilla (no la modifica). */
  @Post(':slug/use')
  @RequirePermission('projects.write')
  async use(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(useSchema)) body: z.infer<typeof useSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    const template = starterTemplate(slug);
    if (!template) throw new BadRequestException('Plantilla desconocida.');

    const client = await this.prisma.client.client.findUnique({
      where: { id: body.clientId },
      select: { id: true, status: true },
    });
    if (!client) throw new BadRequestException('El cliente seleccionado no existe.');
    if (client.status === 'ARCHIVED') {
      throw new BadRequestException('No se pueden crear proyectos en un cliente archivado.');
    }

    const project = await this.prisma.client.project.create({
      data: {
        clientId: body.clientId,
        name: body.name,
        description: template.description,
        type: template.projectType,
        ownerId: request.user.id,
        workflows: {
          create: { name: 'Flujo principal', isMain: true, draftGraph: template.graph as unknown as Prisma.InputJsonValue },
        },
        environments: { create: [{ kind: 'DEVELOPMENT' }, { kind: 'TESTING' }, { kind: 'PRODUCTION' }] },
      },
      include: { workflows: { where: { isMain: true }, select: { id: true } } },
    });

    await this.audit.log({
      userId: request.user.id,
      action: 'project.created_from_template',
      entityType: 'project',
      entityId: project.id,
      detail: { template: slug, name: body.name },
    });
    return { id: project.id, workflowId: project.workflows[0]?.id };
  }
}
