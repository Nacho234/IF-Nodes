'use client';

import { use, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { timeAgo } from '@/lib/utils';
import type { ProjectDetail } from '@/lib/types';

interface ContactRow {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  tags: string[];
  updatedAt: string;
}

const ALL = '__all__';
const STATUS_VARIANT: Record<string, 'neutral' | 'accent' | 'success' | 'warning'> = {
  new: 'neutral',
  contacted: 'accent',
  replied: 'accent',
  meeting: 'warning',
  handoff: 'warning',
  closed: 'success',
};

export default function ContactsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const [status, setStatus] = useState<string>(ALL);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
  });
  const contacts = useQuery({
    queryKey: ['contacts', projectId, status],
    queryFn: () =>
      api.get<ContactRow[]>(`/projects/${projectId}/contacts${status !== ALL ? `?status=${status}` : ''}`),
  });

  const statuses = Array.from(new Set((contacts.data ?? []).map((c) => c.status)));

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Proyectos', href: '/projects' },
          { label: project.data?.name ?? '…', href: `/projects/${projectId}` },
          { label: 'Contactos' },
        ]}
        title="Contactos"
        description="Las personas que pasan por los flujos, con su etapa. Los nodos de contactos los crean y actualizan."
      />

      <div className="flex-1 space-y-4 p-6">
        <div className="flex items-center gap-2">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-52" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              {statuses.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {contacts.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (contacts.data ?? []).length === 0 ? (
          <EmptyState
            icon={<Users />}
            title="Todavía no hay contactos"
            description="Cuando un flujo use el nodo Crear/actualizar contacto, las personas van a aparecer acá con su etapa."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contacto</TableHead>
                <TableHead>Teléfono / Email</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Etiquetas</TableHead>
                <TableHead className="text-right">Actualizado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(contacts.data ?? []).map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.phone ?? ''}
                    {c.phone && c.email ? ' · ' : ''}
                    {c.email ?? ''}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[c.status] ?? 'neutral'} dot>
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <Badge key={t} variant="neutral" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-faint-foreground tabular-nums">
                    {timeAgo(c.updatedAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </>
  );
}
