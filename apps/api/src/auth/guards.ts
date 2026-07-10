import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@ifnodes/database';
import { roleHasPermission, type Permission, type UserRole } from '@ifnodes/shared';
import { SESSION_COOKIE, SessionService } from './session.service';

export interface AuthenticatedRequest extends Request {
  user: User;
  sessionToken: string;
}

/**
 * Autenticación por cookie de sesión + defensa CSRF:
 * toda mutación (métodos no GET/HEAD) exige el header x-ifn-csrf,
 * que un formulario cross-site no puede enviar sin pasar por CORS.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE] ?? '';
    const session = await this.sessions.validate(token);
    if (!session) {
      throw new UnauthorizedException('Sesión inválida o expirada.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers['x-ifn-csrf'] !== '1') {
      throw new ForbiddenException('Falta el header anti-CSRF.');
    }
    request.user = session.user;
    request.sessionToken = token;
    return true;
  }
}

export const PERMISSION_KEY = 'ifn:required-permission';

/** Requiere un permiso de la matriz compartida (packages/shared/permissions.ts). */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.user?.role as UserRole | undefined;
    if (!role || !roleHasPermission(role, permission)) {
      throw new ForbiddenException('No tenés permisos para esta acción.');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): User => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.user;
});
