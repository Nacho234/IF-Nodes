import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Session, User } from '@ifnodes/database';
import { PrismaService } from '../common/prisma.service';

export const SESSION_COOKIE = 'ifn_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días, expiración deslizante
const TOUCH_INTERVAL_MS = 60 * 60 * 1000; // renovar como mucho una vez por hora

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  /** Crea una sesión y devuelve el token en claro (solo viaja en la cookie). */
  async create(userId: string, meta: { ip?: string; userAgent?: string }): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.prisma.client.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    return token;
  }

  /** Valida el token de la cookie; devuelve sesión+usuario o null. */
  async validate(token: string): Promise<(Session & { user: User }) | null> {
    if (!token || token.length !== 64) return null;
    const session = await this.prisma.client.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || !session.user.active) return null;
    if (session.expiresAt.getTime() < Date.now()) {
      await this.prisma.client.session.delete({ where: { id: session.id } }).catch(() => undefined);
      return null;
    }
    // Expiración deslizante, actualizada como mucho una vez por hora
    if (Date.now() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
      });
    }
    return session;
  }

  async revoke(token: string): Promise<void> {
    await this.prisma.client.session
      .delete({ where: { tokenHash: hashToken(token) } })
      .catch(() => undefined);
  }
}
