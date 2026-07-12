'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, FolderKanban, MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, PROJECT_TYPE_LABELS } from '@ifnodes/shared';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { ProjectStatusBadge } from '@/components/status-badges';
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
import { ProjectFormDialog } from '@/features/projects/project-form-dialog';
import type { ProjectRow } from '@/lib/types';

const ALL = '__all__';

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<ProjectRow | undefined>(undefined);

  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/projects?includeArchived=true'),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['projects'] });
  const archive = async (project: ProjectRow) => {
    await api.patch(`/projects/${project.id}`, { status: 'ARCHIVED' });
    refresh();
  };

  const filtered = useMemo(() => {
    const list = projects.data ?? [];
    return list.filter((project) => {
      if (statusFilter === ALL && project.status === 'ARCHIVED') return false;
      if (statusFilter !== ALL && project.status !== statusFilter) return false;
      if (query) {
        const q = query.toLowerCase();
        return project.name.toLowerCase().includes(q) || project.client.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [projects.data, query, statusFilter]);

  return (
    <>
      <PageHeader
        title="Proyectos"
        description="Bots y automatizaciones en construcción, prueba y producción."
        actions={
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            <Plus /> Nuevo proyecto
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
              placeholder="Buscar por proyecto o cliente…"
              className="w-72 pl-8"
              aria-label="Buscar proyecto"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-52" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Activos (sin archivados)</SelectItem>
              {PROJECT_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {PROJECT_STATUS_LABELS[status]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {projects.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : projects.isError ? (
          <ErrorState message="No se pudieron cargar los proyectos." retry={() => void projects.refetch()} />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FolderKanban />}
            title={query || statusFilter !== ALL ? 'Sin resultados con estos filtros' : 'Todavía no hay proyectos'}
            description={
              query || statusFilter !== ALL
                ? 'Probá con otro término o cambiá el filtro.'
                : 'Un proyecto agrupa los flujos de un bot o automatización de un cliente.'
            }
            action={
              !query && statusFilter === ALL ? (
                <Button variant="primary" onClick={() => setDialogOpen(true)}>
                  <Plus /> Nuevo proyecto
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Flujos</TableHead>
                <TableHead>Responsable</TableHead>
                <TableHead className="text-right">Actualizado</TableHead>
                <TableHead className="w-10" aria-label="Acciones" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link href={`/projects/${project.id}`} className="font-medium hover:text-accent">
                      {project.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{project.client.name}</TableCell>
                  <TableCell className="text-muted-foreground">{PROJECT_TYPE_LABELS[project.type]}</TableCell>
                  <TableCell>
                    <ProjectStatusBadge status={project.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{project._count.workflows}</TableCell>
                  <TableCell className="text-muted-foreground">{project.owner?.name ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-faint-foreground tabular-nums">
                    {timeAgo(project.updatedAt)}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${project.name}`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {project.status !== 'ARCHIVED' ? (
                          <DropdownMenuItem onSelect={() => void archive(project)}>
                            <Archive /> Archivar
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          className="text-danger data-[highlighted]:bg-danger-soft"
                          onSelect={() => setDeleting(project)}
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

      <ProjectFormDialog open={dialogOpen} onOpenChange={setDialogOpen} />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(undefined)}
        title="Eliminar proyecto"
        description={
          <>
            Vas a eliminar <strong>{deleting?.name}</strong> con todos sus flujos, ejecuciones, casos de prueba
            y versiones. Esta acción no se puede deshacer.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          await api.delete(`/projects/${deleting.id}`);
          refresh();
        }}
      />
    </>
  );
}
