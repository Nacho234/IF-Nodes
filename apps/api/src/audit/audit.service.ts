import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

export interface AuditEntry {
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  /** Cambios relevantes; NUNCA incluir secretos ni payloads sensibles */
  detail?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** La auditoría no debe tumbar la operación principal: loguea y sigue. */
  async log(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId,
          detail: entry.detail as never,
          ip: entry.ip,
          userAgent: entry.userAgent?.slice(0, 300),
        },
      });
    } catch (error) {
      this.logger.error(`No se pudo registrar auditoría ${entry.action}: ${String(error)}`);
    }
  }
}
