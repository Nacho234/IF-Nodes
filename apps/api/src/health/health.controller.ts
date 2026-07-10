import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    const database = await this.databaseStatus();
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const database = await this.databaseStatus();
    if (database !== 'up') {
      throw new ServiceUnavailableException({ status: 'not_ready', database });
    }
    return { status: 'ready', database };
  }

  private async databaseStatus(): Promise<'up' | 'down'> {
    try {
      await this.prisma.client.$queryRaw`SELECT 1`;
      return 'up';
    } catch {
      return 'down';
    }
  }
}
