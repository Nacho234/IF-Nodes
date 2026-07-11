'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Blocks, LayoutTemplate, Workflow } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import type { ClientRow, TemplateInfo } from '@/lib/types';

export default function TemplatesPage() {
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<TemplateInfo[]>('/templates'),
  });
  const [selected, setSelected] = useState<TemplateInfo | null>(null);

  return (
    <>
      <PageHeader
        title="Plantillas"
        description="Puntos de partida listos. Al usar una, se crea un proyecto nuevo con su flujo."
      />

      <div className="flex-1 p-6">
        {templates.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        ) : templates.isError ? (
          <ErrorState message="No se pudieron cargar las plantillas." retry={() => void templates.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(templates.data ?? []).map((template) => (
              <div key={template.slug} className="flex flex-col rounded-lg border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent">
                    <LayoutTemplate className="size-4.5" strokeWidth={1.75} />
                  </span>
                  <Badge variant="neutral">{template.category}</Badge>
                </div>
                <p className="mt-3 text-sm font-medium">{template.name}</p>
                <p className="mt-0.5 flex-1 text-[12.5px] text-muted-foreground">{template.description}</p>

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-[11px] text-faint-foreground">
                    <Workflow className="size-3" /> {template.nodeCount} nodos
                  </span>
                  {template.requiredIntegrations.map((slug) => (
                    <Badge key={slug} variant="outline" className="gap-1 font-mono text-[10px]">
                      <Blocks className="size-2.5" /> {slug}
                    </Badge>
                  ))}
                </div>

                <Button variant="primary" size="sm" className="mt-4" onClick={() => setSelected(template)}>
                  Usar plantilla
                </Button>
              </div>
            ))}
          </div>
        )}

        <p className="mt-6 text-[11px] text-faint-foreground">
          Las integraciones indicadas son recomendadas: conviene tener sus credenciales para que el flujo
          funcione. Sin credencial de IA, los nodos de IA responden en modo desarrollo.
        </p>
      </div>

      <UseTemplateDialog template={selected} onClose={() => setSelected(null)} />
    </>
  );
}

function UseTemplateDialog({ template, onClose }: { template: TemplateInfo | null; onClose: () => void }) {
  const router = useRouter();
  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<ClientRow[]>('/clients'),
    enabled: Boolean(template),
  });
  const selectable = (clients.data ?? []).filter((c) => c.status !== 'ARCHIVED');

  const use = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/templates/${template?.slug}/use`, { clientId, name }),
    onSuccess: ({ id }) => {
      onClose();
      router.push(`/projects/${id}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo crear el proyecto.'),
  });

  return (
    <Dialog open={Boolean(template)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={template ? `Usar «${template.name}»` : ''}
        description="Se crea un proyecto nuevo con el flujo de la plantilla. Podés editarlo libremente después."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            use.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="tpl-client">
              Cliente <span className="text-danger">*</span>
            </Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="tpl-client">
                <SelectValue placeholder={clients.isLoading ? 'Cargando…' : 'Seleccioná un cliente'} />
              </SelectTrigger>
              <SelectContent>
                {selectable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!clients.isLoading && selectable.length === 0 ? (
              <p className="text-xs text-warning">No hay clientes activos: creá uno primero.</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tpl-name">
              Nombre del proyecto <span className="text-danger">*</span>
            </Label>
            <Input
              id="tpl-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={template?.name}
            />
          </div>

          {error ? <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p> : null}

          <DialogFooter>
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={use.isPending} disabled={!clientId || !name}>
              Crear proyecto
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
