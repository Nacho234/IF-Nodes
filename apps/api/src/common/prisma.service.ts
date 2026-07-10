import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { prisma, type PrismaClient } from '@ifnodes/database';

/** Expone el cliente Prisma singleton dentro del ciclo de vida de Nest. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient = prisma;

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
