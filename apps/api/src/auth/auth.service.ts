import { ForbiddenException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import type { User } from '@ifnodes/database';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { loadEnv } from '../config/env';

interface GoogleProfile {
  email: string;
  name: string;
  avatarUrl?: string;
}

/**
 * Autenticación interna: Google OAuth con lista de emails autorizados.
 * Punto de extensión: para sumar otro proveedor (p.ej. Microsoft) se agrega
 * otro método que termine llamando a resolveAuthorizedUser().
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly env = loadEnv();
  private readonly googleClient: OAuth2Client | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {
    this.googleClient = this.env.googleConfigured
      ? new OAuth2Client(this.env.GOOGLE_CLIENT_ID, this.env.GOOGLE_CLIENT_SECRET, this.env.GOOGLE_REDIRECT_URI)
      : null;
  }

  authMethods(): { google: boolean; devLogin: boolean } {
    return { google: this.env.googleConfigured, devLogin: this.env.devLoginEnabled };
  }

  googleAuthUrl(state: string): string {
    if (!this.googleClient) {
      throw new ServiceUnavailableException(
        'Google OAuth no está configurado. Definí GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET (ver .env.example).',
      );
    }
    return this.googleClient.generateAuthUrl({
      scope: ['openid', 'email', 'profile'],
      state,
      prompt: 'select_account',
    });
  }

  async handleGoogleCallback(code: string, meta: { ip?: string; userAgent?: string }): Promise<User> {
    if (!this.googleClient) {
      throw new ServiceUnavailableException('Google OAuth no está configurado.');
    }
    const { tokens } = await this.googleClient.getToken(code);
    if (!tokens.id_token) {
      throw new ForbiddenException('Google no devolvió un id_token válido.');
    }
    const ticket = await this.googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email || payload.email_verified !== true) {
      throw new ForbiddenException('La cuenta de Google no tiene un email verificado.');
    }
    return this.resolveAuthorizedUser(
      {
        email: payload.email,
        name: payload.name ?? payload.email,
        avatarUrl: payload.picture,
      },
      'auth.login.google',
      meta,
    );
  }

  /**
   * Ingreso de desarrollo, sin Google. Solo existe con AUTH_DEV_LOGIN=true y
   * NODE_ENV != production; respeta la misma lista de autorizados y se audita.
   */
  async devLogin(email: string, meta: { ip?: string; userAgent?: string }): Promise<User> {
    if (!this.env.devLoginEnabled) {
      throw new ForbiddenException('El ingreso de desarrollo está deshabilitado.');
    }
    return this.resolveAuthorizedUser(
      { email: email.trim().toLowerCase(), name: email.split('@')[0] ?? email },
      'auth.login.dev',
      meta,
    );
  }

  private async resolveAuthorizedUser(
    profile: GoogleProfile,
    auditAction: string,
    meta: { ip?: string; userAgent?: string },
  ): Promise<User> {
    const email = profile.email.toLowerCase();
    if (!this.env.AUTHORIZED_EMAILS.includes(email)) {
      await this.audit.log({
        action: 'auth.login.rejected',
        entityType: 'user',
        detail: { email, reason: 'email fuera de AUTHORIZED_EMAILS' },
        ...meta,
      });
      this.logger.warn(`Login rechazado para ${email}: no está en la lista de autorizados`);
      throw new ForbiddenException('Este email no está autorizado para usar la aplicación.');
    }

    const existing = await this.prisma.client.user.findUnique({ where: { email } });
    let user: User;
    if (existing) {
      user = await this.prisma.client.user.update({
        where: { id: existing.id },
        data: { name: profile.name, avatarUrl: profile.avatarUrl ?? existing.avatarUrl },
      });
    } else {
      // El primer usuario del sistema es OWNER; el resto entra como DEVELOPER
      const userCount = await this.prisma.client.user.count();
      user = await this.prisma.client.user.create({
        data: {
          email,
          name: profile.name,
          avatarUrl: profile.avatarUrl,
          role: userCount === 0 ? 'OWNER' : 'DEVELOPER',
        },
      });
    }

    await this.audit.log({
      userId: user.id,
      action: auditAction,
      entityType: 'user',
      entityId: user.id,
      ...meta,
    });
    return user;
  }
}
