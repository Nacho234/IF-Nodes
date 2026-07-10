'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import {
  CLIENT_STATUSES,
  CLIENT_STATUS_LABELS,
  createClientSchema,
  type CreateClientInput,
} from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ClientRow } from '@/lib/types';
import { useState } from 'react';

export function ClientFormDialog({
  open,
  onOpenChange,
  client,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, es edición; si no, alta */
  client?: ClientRow;
}) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<CreateClientInput>({
    resolver: zodResolver(createClientSchema),
    values: client
      ? {
          name: client.name,
          legalName: client.legalName ?? '',
          industry: client.industry ?? '',
          contactName: client.contactName ?? '',
          contactEmail: client.contactEmail ?? '',
          contactPhone: client.contactPhone ?? '',
          status: client.status,
          internalNotes: client.internalNotes ?? '',
        }
      : {
          name: '',
          legalName: '',
          industry: '',
          contactName: '',
          contactEmail: '',
          contactPhone: '',
          status: 'PROSPECT',
          internalNotes: '',
        },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateClientInput) =>
      client ? api.patch<ClientRow>(`/clients/${client.id}`, data) : api.post<ClientRow>('/clients', data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
      onOpenChange(false);
      form.reset();
      setServerError(null);
    },
    onError: (error) => {
      setServerError(error instanceof ApiError ? error.message : 'No se pudo guardar el cliente.');
    },
  });

  const status = form.watch('status');
  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={client ? 'Editar cliente' : 'Nuevo cliente'}
        description={client ? client.name : 'Entidad organizativa interna: agrupa los proyectos de un cliente.'}
      >
        <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="client-name">
                Nombre <span className="text-danger">*</span>
              </Label>
              <Input id="client-name" autoFocus {...form.register('name')} />
              {errors.name ? <p className="text-xs text-danger">{errors.name.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-legal">Nombre comercial</Label>
              <Input id="client-legal" {...form.register('legalName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-industry">Rubro</Label>
              <Input id="client-industry" placeholder="Estética, petshop, viajes…" {...form.register('industry')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-contact">Persona de contacto</Label>
              <Input id="client-contact" {...form.register('contactName')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-status">Estado</Label>
              <Select value={status} onValueChange={(value) => form.setValue('status', value as CreateClientInput['status'])}>
                <SelectTrigger id="client-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {CLIENT_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-email">Email</Label>
              <Input id="client-email" type="email" {...form.register('contactEmail')} />
              {errors.contactEmail ? <p className="text-xs text-danger">{errors.contactEmail.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-phone">Teléfono</Label>
              <Input id="client-phone" type="tel" {...form.register('contactPhone')} />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="client-notes">Notas internas</Label>
              <Textarea id="client-notes" rows={3} {...form.register('internalNotes')} />
            </div>
          </div>

          {serverError ? (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={mutation.isPending}>
              {client ? 'Guardar cambios' : 'Crear cliente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
