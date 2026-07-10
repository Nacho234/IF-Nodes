import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  CLIENT_STATUSES,
  createClientSchema,
  updateClientSchema,
  type CreateClientInput,
  type UpdateClientInput,
} from '@ifnodes/shared';
import { z } from 'zod';
import { ClientsService } from './clients.service';
import { PermissionsGuard, RequirePermission, SessionGuard, type AuthenticatedRequest } from '../auth/guards';
import { ZodValidationPipe } from '../common/zod-validation.pipe';

const listQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(CLIENT_STATUSES).optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
});

@UseGuards(SessionGuard, PermissionsGuard)
@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @RequirePermission('clients.read')
  list(@Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>) {
    return this.clients.list(query);
  }

  @Get(':id')
  @RequirePermission('clients.read')
  get(@Param('id') id: string) {
    return this.clients.get(id);
  }

  @Post()
  @RequirePermission('clients.write')
  create(
    @Body(new ZodValidationPipe(createClientSchema)) body: CreateClientInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.clients.create(body, request.user);
  }

  @Patch(':id')
  @RequirePermission('clients.write')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateClientSchema)) body: UpdateClientInput,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.clients.update(id, body, request.user);
  }
}
