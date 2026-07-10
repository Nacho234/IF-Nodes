import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { permissionsForRole, type UserRole } from '@ifnodes/shared';
import { AuthService } from './auth.service';
import { SESSION_COOKIE, SessionService } from './session.service';
import { CurrentUser, SessionGuard, type AuthenticatedRequest } from './guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { loadEnv } from '../config/env';
import type { User } from '@ifnodes/database';

const devLoginSchema = z.object({ email: z.string().email('Email inválido') });

function requestMeta(request: Request): { ip?: string; userAgent?: string } {
  return { ip: request.ip, userAgent: request.headers['user-agent'] };
}

@Controller('auth')
export class AuthController {
  private readonly env = loadEnv();

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  /** Métodos de login disponibles (la web arma la pantalla según esto). */
  @Get('methods')
  methods() {
    return this.auth.authMethods();
  }

  @Get('google')
  google(@Res() response: Response) {
    const state = randomBytes(16).toString('hex');
    response.cookie('ifn_oauth_state', state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.isProduction,
      maxAge: 10 * 60 * 1000,
    });
    response.redirect(this.auth.googleAuthUrl(state));
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const expectedState = (request.cookies as Record<string, string>)['ifn_oauth_state'];
    response.clearCookie('ifn_oauth_state');
    if (!code || !state || !expectedState || state !== expectedState) {
      response.redirect(`${this.env.WEB_ORIGIN}/login?error=oauth_state`);
      return;
    }
    try {
      const user = await this.auth.handleGoogleCallback(code, requestMeta(request));
      await this.attachSession(response, user, request);
      response.redirect(this.env.WEB_ORIGIN);
    } catch {
      response.redirect(`${this.env.WEB_ORIGIN}/login?error=unauthorized`);
    }
  }

  /** Ingreso de desarrollo (ver SECURITY.md). Deshabilitado en producción. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('dev-login')
  @HttpCode(200)
  async devLogin(
    @Body(new ZodValidationPipe(devLoginSchema)) body: z.infer<typeof devLoginSchema>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const user = await this.auth.devLogin(body.email, requestMeta(request));
    await this.attachSession(response, user, request);
    return this.userPayload(user);
  }

  @UseGuards(SessionGuard)
  @Get('me')
  me(@CurrentUser() user: User) {
    return this.userPayload(user);
  }

  @UseGuards(SessionGuard)
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.sessions.revoke(request.sessionToken);
    response.clearCookie(SESSION_COOKIE);
    return { ok: true };
  }

  private async attachSession(response: Response, user: User, request: Request): Promise<void> {
    const token = await this.sessions.create(user.id, requestMeta(request));
    response.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.isProduction,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
  }

  private userPayload(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role: user.role,
      permissions: permissionsForRole(user.role as UserRole),
    };
  }
}
