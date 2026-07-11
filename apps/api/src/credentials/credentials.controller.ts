import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  CREDENTIAL_TYPES,
  ENVIRONMENT_KINDS,
  createCredentialSchema,
  updateCredentialSchema,
} from '@ifnodes/shared';
import { z } from 'zod';
import { CredentialsService } from './credentials.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const listQuerySchema = z.object({
  projectId: z.string().optional(),
  environment: z.enum(ENVIRONMENT_KINDS).optional(),
});

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  /** Catálogo de tipos de credencial (para el formulario). Sin datos sensibles. */
  @Get('types')
  types() {
    return CREDENTIAL_TYPES;
  }

  @Get()
  @RequirePermission('credentials.read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.credentials.list(query);
  }

  @Get(':id')
  @RequirePermission('credentials.read')
  get(@Param('id') id: string) {
    return this.credentials.get(id);
  }

  @Post()
  @RequirePermission('credentials.write')
  create(
    @Body(new ZodValidationPipe(createCredentialSchema)) body: z.infer<typeof createCredentialSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.credentials.create(body, request.user);
  }

  @Patch(':id')
  @RequirePermission('credentials.write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCredentialSchema)) body: z.infer<typeof updateCredentialSchema>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.credentials.update(id, body, request.user);
  }

  @Delete(':id')
  @RequirePermission('credentials.write')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.credentials.remove(id, request.user);
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermission('credentials.write')
  verify(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.credentials.verify(id, request.user);
  }
}
