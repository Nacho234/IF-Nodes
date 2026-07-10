import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaService } from './common/prisma.service';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { SessionService } from './auth/session.service';
import { SessionGuard, PermissionsGuard } from './auth/guards';
import { ClientsController } from './clients/clients.controller';
import { ClientsService } from './clients/clients.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { WorkflowsController } from './workflows/workflows.controller';
import { WorkflowsService } from './workflows/workflows.service';
import { NodeTypesController } from './workflows/node-types.controller';
import { ExecutionsController } from './executions/executions.controller';
import { ExecutionsService } from './executions/executions.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    // Rate limiting global: 120 req/min por IP (más estricto en /auth vía @Throttle)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
  ],
  controllers: [
    AuthController,
    ClientsController,
    ProjectsController,
    WorkflowsController,
    NodeTypesController,
    ExecutionsController,
    HealthController,
  ],
  providers: [
    PrismaService,
    AuditService,
    AuthService,
    SessionService,
    SessionGuard,
    PermissionsGuard,
    ClientsService,
    ProjectsService,
    WorkflowsService,
    ExecutionsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
