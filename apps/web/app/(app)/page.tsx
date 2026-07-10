import Link from 'next/link';
import { ArrowRight, Building2, FolderKanban, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ProjectStatusBadge } from '@/components/status-badges';
import { EmptyState } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { serverApiGet } from '@/lib/server-api';
import { timeAgo } from '@/lib/utils';
import { PROJECT_TYPE_LABELS } from '@ifnodes/shared';
import type { ClientRow, ProjectRow } from '@/lib/types';

export default async function HomePage() {
  const [projects, clients] = await Promise.all([
    serverApiGet<ProjectRow[]>('/projects'),
    serverApiGet<ClientRow[]>('/clients'),
  ]);

  const projectList = projects ?? [];
  const clientList = clients ?? [];
  const inDevelopment = projectList.filter((p) => p.status === 'IN_DEVELOPMENT').length;
  const inTesting = projectList.filter((p) => p.status === 'IN_TESTING').length;
  const ready = projectList.filter((p) =>
    ['READY_FOR_PRODUCTION', 'EXPORTED', 'IN_PRODUCTION'].includes(p.status),
  ).length;
  const recent = projectList.slice(0, 8);

  return (
    <>
      <PageHeader
        title="Inicio"
        description="Estado general del taller de bots y automatizaciones."
      />
      <div className="flex-1 space-y-6 p-6">
        {/* Resumen numérico (datos reales de la DB) */}
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border lg:grid-cols-4">
          {[
            { label: 'Proyectos en desarrollo', value: inDevelopment },
            { label: 'Proyectos en pruebas', value: inTesting },
            { label: 'Listos / en producción', value: ready },
            { label: 'Clientes activos', value: clientList.filter((c) => c.status !== 'ARCHIVED').length },
          ].map((stat) => (
            <div key={stat.label} className="bg-surface px-5 py-4">
              <dt className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">{stat.label}</dt>
              <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Proyectos modificados recientemente</h2>
            <Link
              href="/projects"
              className="flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              Ver todos <ArrowRight className="size-3" />
            </Link>
          </div>

          {recent.length === 0 ? (
            <EmptyState
              icon={<Workflow />}
              title="Todavía no hay proyectos"
              description="Creá un cliente y su primer proyecto para empezar a construir flujos."
              action={
                <div className="flex gap-2">
                  <Link
                    href="/clients"
                    className="inline-flex h-8.5 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3.5 text-sm font-medium hover:bg-surface-sunken"
                  >
                    <Building2 className="size-4" /> Crear cliente
                  </Link>
                  <Link
                    href="/projects"
                    className="inline-flex h-8.5 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-foreground hover:opacity-90"
                  >
                    <FolderKanban className="size-4" /> Crear proyecto
                  </Link>
                </div>
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
                  <TableHead className="text-right">Actualizado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((project) => (
                  <TableRow key={project.id}>
                    <TableCell>
                      <Link href={`/projects/${project.id}`} className="font-medium text-foreground hover:text-accent">
                        {project.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{project.client.name}</TableCell>
                    <TableCell className="text-muted-foreground">{PROJECT_TYPE_LABELS[project.type]}</TableCell>
                    <TableCell>
                      <ProjectStatusBadge status={project.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-faint-foreground tabular-nums">
                      {timeAgo(project.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <p className="text-[11px] text-faint-foreground">
          Las métricas de ejecuciones, errores y consumo de IA se suman cuando el motor esté activo (Fase 3–4).
        </p>
      </div>
    </>
  );
}
