'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Building2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { CLIENT_STATUSES, CLIENT_STATUS_LABELS, type ClientStatus } from '@ifnodes/shared';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { ClientStatusBadge } from '@/components/status-badges';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ClientFormDialog } from '@/features/clients/client-form-dialog';
import type { ClientRow } from '@/lib/types';

const ALL = '__all__';

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ClientRow | undefined>(undefined);
  const [deleting, setDeleting] = useState<ClientRow | undefined>(undefined);

  const clients = useQuery({
    queryKey: ['clients'],
    queryFn: () => api.get<ClientRow[]>('/clients?includeArchived=true'),
  });

  const archive = useMutation({
    mutationFn: (client: ClientRow) =>
      api.patch(`/clients/${client.id}`, { status: 'ARCHIVED' satisfies ClientStatus }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['clients'] }),
  });

  const filtered = useMemo(() => {
    const list = clients.data ?? [];
    return list.filter((client) => {
      if (statusFilter === ALL && client.status === 'ARCHIVED') return false;
      if (statusFilter !== ALL && client.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return (
          client.name.toLowerCase().includes(q) ||
          (client.contactName ?? '').toLowerCase().includes(q) ||
          (client.industry ?? '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [clients.data, query, statusFilter]);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Organizá los proyectos por cliente. Entidad interna, sin portal público."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus /> Nuevo cliente
          </Button>
        }
      />

      <div className="flex-1 space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar cliente…"
              className="w-64 pl-8"
              aria-label="Buscar cliente"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Activos (sin archivados)</SelectItem>
              {CLIENT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {CLIENT_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {clients.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : clients.isError ? (
          <ErrorState message="No se pudieron cargar los clientes." retry={() => void clients.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 />}
            title={query || statusFilter !== ALL ? 'Sin resultados con estos filtros' : 'Todavía no hay clientes'}
            description={
              query || statusFilter !== ALL
                ? 'Probá con otro término o cambiá el filtro de estado.'
                : 'Creá el primer cliente para poder asociarle proyectos.'
            }
            action={
              !query && statusFilter === ALL ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditing(undefined);
                    setDialogOpen(true);
                  }}
                >
                  <Plus /> Nuevo cliente
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Rubro</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Proyectos</TableHead>
                <TableHead className="text-right">Actualizado</TableHead>
                <TableHead className="w-10" aria-label="Acciones" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((client) => (
                <TableRow key={client.id}>
                  <TableCell>
                    <p className="font-medium">{client.name}</p>
                    {client.legalName ? (
                      <p className="text-xs text-faint-foreground">{client.legalName}</p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{client.industry ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {client.contactName ?? '—'}
                    {client.contactEmail ? (
                      <p className="text-xs text-faint-foreground">{client.contactEmail}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <ClientStatusBadge status={client.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{client._count.projects}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-faint-foreground tabular-nums">
                    {timeAgo(client.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${client.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(client);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil /> Editar
                        </DropdownMenuItem>
                        {client.status !== 'ARCHIVED' ? (
                          <DropdownMenuItem onSelect={() => archive.mutate(client)}>
                            <Archive /> Archivar
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="text-danger data-[highlighted]:bg-danger-soft"
                          onSelect={() => setDeleting(client)}
                        >
                          <Trash2 /> Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <ClientFormDialog open={dialogOpen} onOpenChange={setDialogOpen} client={editing} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title="Eliminar cliente"
        description={
          <>
            Vas a eliminar <strong>{deleting?.name}</strong>. Si tiene proyectos, primero hay que eliminarlos.
            Esta acción no se puede deshacer.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          await api.delete(`/clients/${deleting.id}`);
          await queryClient.invalidateQueries({ queryKey: ['clients'] });
        }}
      />
    </>
  );
}
