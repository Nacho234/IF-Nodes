'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  PROJECT_TYPES,
  PROJECT_TYPE_LABELS,
  createProjectSchema,
  type CreateProjectInput,
} from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ClientRow, ProjectRow } from '@/lib/types';

export function ProjectFormDialog({
  open,
  onOpenChange,
  presetClientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetClientId?: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<ClientRow[]>('/clients?includeArchived=true'),
    enabled: open,
  });

  const form = useForm<CreateProjectInput>({
    resolver: zodResolver(createProjectSchema),
    defaultValues: {
      clientId: presetClientId ?? '',
      name: '',
      description: '',
      type: 'WHATSAPP_BOT',
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateProjectInput) => api.post<ProjectRow>('/projects', data),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      onOpenChange(false);
      form.reset();
      router.push(`/projects/${project.id}`);
    },
    onError: (error) => {
      setServerError(error instanceof ApiError ? error.message : 'No se pudo crear el proyecto.');
    },
  });

  const { errors } = form.formState;
  const selectableClients = (clients.data ?? []).filter((client) => client.status !== 'ARCHIVED');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Nuevo proyecto"
        description="Cada proyecto es un bot o automatización de un cliente. Se crea con su flujo principal y los entornos Development, Testing y Production."
      >
        <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="project-client">
              Cliente <span className="text-danger">*</span>
            </Label>
            <Select value={form.watch('clientId')} onValueChange={(value) => form.setValue('clientId', value)}>
              <SelectTrigger id="project-client">
                <SelectValue placeholder={clients.isLoading ? 'Cargando clientes…' : 'Seleccioná un cliente'} />
              </SelectTrigger>
              <SelectContent>
                {selectableClients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.clientId ? <p className="text-xs text-danger">{errors.clientId.message}</p> : null}
            {!clients.isLoading && selectableClients.length === 0 ? (
              <p className="text-xs text-warning">No hay clientes activos: creá uno primero en la sección Clientes.</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-name">
              Nombre <span className="text-danger">*</span>
            </Label>
            <Input id="project-name" placeholder="Bot de WhatsApp — turnos" {...form.register('name')} />
            {errors.name ? <p className="text-xs text-danger">{errors.name.message}</p> : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-type">Tipo</Label>
            <Select
              value={form.watch('type')}
              onValueChange={(value) => form.setValue('type', value as CreateProjectInput['type'])}
            >
              <SelectTrigger id="project-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {PROJECT_TYPE_LABELS[type]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="project-description">Descripción</Label>
            <Textarea
              id="project-description"
              rows={3}
              placeholder="Qué automatiza, para qué área del cliente…"
              {...form.register('description')}
            />
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
              Crear proyecto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
