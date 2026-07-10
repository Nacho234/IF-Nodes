'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ListChecks } from 'lucide-react';
import { EXECUTION_STATUSES } from '@ifnodes/shared';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { ExecutionStatusBadge } from '@/components/execution-status-badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ExecutionRow } from '@/lib/types';

const ALL = '__all__';

const STATUS_LABELS: Record<string, string> = {
  QUEUED: 'En cola',
  RUNNING: 'Ejecutando',
  WAITING: 'Esperando',
  SUCCEEDED: 'Exitosa',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
  TIMED_OUT: 'Timeout',
};

export default function ExecutionsPage() {
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const executions = useQuery({
    queryKey: ['executions', statusFilter],
    queryFn: () =>
      api.get<ExecutionRow[]>(
        `/executions?take=100${statusFilter !== ALL ? `&status=${statusFilter}` : ''}`,
      ),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((row) => row.status === 'QUEUED' || row.status === 'RUNNING')
        ? 2000
        : false,
  });

  return (
    <>
      <PageHeader
        title="Ejecuciones"
        description="Historial global de pruebas y ejecuciones de flujos."
        actions={
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-44" aria-label="Filtrar por estado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos los estados</SelectItem>
              {EXECUTION_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {STATUS_LABELS[status] ?? status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <div className="flex-1 p-6">
        {executions.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11 w-full" />
            ))}
          </div>
        ) : executions.isError ? (
          <ErrorState message="No se pudieron cargar las ejecuciones." retry={() => void executions.refetch()} />
        ) : (executions.data ?? []).length === 0 ? (
          <EmptyState
            icon={<ListChecks />}
            title="Todavía no hay ejecuciones"
            description="Ejecutá un flujo desde el constructor (botón Ejecutar) para ver acá el historial con el detalle por nodo."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Flujo</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Disparador</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Pasos</TableHead>
                <TableHead className="text-right">Duración</TableHead>
                <TableHead className="text-right">Inicio</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(executions.data ?? []).map((execution) => (
                <TableRow key={execution.id}>
                  <TableCell>
                    <Link href={`/executions/${execution.id}`} className="font-medium hover:text-accent">
                      {execution.project.name}
                    </Link>
                    <p className="text-xs text-faint-foreground">{execution.project.client.name}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{execution.workflow.name}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {execution.version ? `v${execution.version.number}` : 'borrador'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{execution.triggerType}</TableCell>
                  <TableCell>
                    <ExecutionStatusBadge status={execution.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{execution._count.steps}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {execution.durationMs !== null ? `${execution.durationMs} ms` : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-faint-foreground tabular-nums">
                    {timeAgo(execution.createdAt)}
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
