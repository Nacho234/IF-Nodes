import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { USER_ROLES } from '@ifnodes/shared';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CurrentUser,
  PermissionsGuard,
  RequirePermission,
  SessionGuard,
  type AuthenticatedRequest,
} from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import type { User } from '@ifnodes/database';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

const roleSchema = z.object({ role: z.enum(USER_ROLES) });

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Equipo: cualquier usuario autenticado puede ver quiénes tienen acceso. */
  @Get()
  async list() {
    return this.prisma.client.user.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
  }

  /** Cambiar el rol de un usuario (solo OWNER). */
  @Patch(':id/role')
  @RequirePermission('users.manage')
  async updateRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(roleSchema)) body: z.infer<typeof roleSchema>,
    @CurrentUser() actor: User,
    @Req() request: AuthenticatedRequest,
  ) {
    if (id === actor.id) {
      throw new BadRequestException('No podés cambiar tu propio rol.');
    }
    const target = await this.prisma.client.user.findUnique({ where: { id } });
    if (!target) throw new BadRequestException('Usuario no encontrado.');
    if (target.role === 'OWNER') {
      throw new ForbiddenException('No se puede cambiar el rol de un OWNER.');
    }
    await this.prisma.client.user.update({ where: { id }, data: { role: body.role } });
    await this.audit.log({
      userId: actor.id,
      action: 'user.role_changed',
      entityType: 'user',
      entityId: id,
      detail: { from: target.role, to: body.role },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { ok: true };
  }
}
