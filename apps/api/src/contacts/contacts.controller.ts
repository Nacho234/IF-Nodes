import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PermissionsGuard, RequirePermission, SessionGuard } from '../auth/guards';
import { PrismaService } from '../common/prisma.service';

/** Lectura de contactos de un proyecto (bandeja/CRM). Los flujos los crean; acá se ven. */
@UseGuards(SessionGuard, PermissionsGuard)
@Controller()
export class ContactsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('projects/:projectId/contacts')
  @RequirePermission('projects.read')
  list(@Param('projectId') projectId: string, @Query('status') status?: string) {
    return this.prisma.client.contact.findMany({
      where: { projectId, ...(status ? { status } : {}) },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
  }
}
