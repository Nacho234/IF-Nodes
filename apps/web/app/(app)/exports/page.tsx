'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Download, PackageOpen } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ExportRow } from '@/lib/types';

export default function ExportsPage() {
  const exports = useQuery({
    queryKey: ['exports'],
    queryFn: () => api.get<ExportRow[]>('/exports'),
  });

  const list = exports.data ?? [];

  return (
    <>
      <PageHeader
        title="Exportaciones"
        description="Runtimes generados a partir de versiones estables, listos para desplegar."
      />

      <div className="flex-1 p-6">
        {exports.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : exports.isError ? (
          <ErrorState message="No se pudieron cargar las exportaciones." retry={() => void exports.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<PackageOpen />}
            title="Todavía no exportaste ningún runtime"
            description="Desde el constructor de un bot, publicá una versión estable y usá el botón «Exportar» para generar el proyecto desplegable."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Proyecto</TableHead>
                <TableHead>Versión</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Tamaño</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead className="w-10" aria-label="Descargar" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((exp) => (
                <TableRow key={exp.id}>
                  <TableCell>
                    <Link href={`/projects/${exp.project.id}`} className="font-medium hover:text-accent">
                      {exp.project.name}
                    </Link>
                    <p className="text-xs text-faint-foreground">{exp.project.client.name}</p>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {exp.version ? `v${exp.version.number}` : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        exp.status === 'COMPLETED' ? 'success' : exp.status === 'FAILED' ? 'danger' : 'warning'
                      }
                      dot
                    >
                      {exp.status === 'COMPLETED' ? 'Listo' : exp.status === 'FAILED' ? 'Falló' : 'Generando'}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs tabular-nums">
                    {exp.sizeBytes ? `${(exp.sizeBytes / 1024).toFixed(0)} KB` : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{exp.createdBy?.name ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs text-faint-foreground tabular-nums">
                    {timeAgo(exp.createdAt)}
                  </TableCell>
                  <TableCell>
                    {exp.status === 'COMPLETED' ? (
                      <a
                        href={`/api/exports/${exp.id}/download`}
                        aria-label="Descargar ZIP"
                        title="Descargar ZIP"
                        className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground"
                      >
                        <Download className="size-4" />
                      </a>
                    ) : null}
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
