import { PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma singleton. Todas las apps importan de acá;
 * nadie instancia PrismaClient por su cuenta.
 */
const globalForPrisma = globalThis as unknown as { __ifnodesPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__ifnodesPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__ifnodesPrisma = prisma;
}

export * from '@prisma/client';
