import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowRight, FlaskConical, GitBranch, ListChecks, Workflow } from 'lucide-react';
import { PROJECT_TYPE_LABELS } from '@ifnodes/shared';
import { PageHeader } from '@/components/shell/page-header';
import { ProjectStatusBadge } from '@/components/status-badges';
import { Badge } from '@/components/ui/badge';
import { serverApiGet } from '@/lib/server-api';
import { formatDateTime, timeAgo } from '@/lib/utils';
import type { ProjectDetail } from '@/lib/types';

/**
 * Detalle del proyecto. Las secciones de fases futuras se listan como
 * "planificadas" (texto informativo, sin botones muertos).
 */
const UPCOMING_SECTIONS = [
  { name: 'Variables por entorno', phase: 'Fase 7' },
  { name: 'Exportar runtime', phase: 'Fase 9' },
];

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await serverApiGet<ProjectDetail>(`/projects/${id}`);
  if (!project) notFound();

  const mainWorkflow = project.workflows.find((workflow) => workflow.isMain) ?? project.workflows[0];

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Proyectos', href: '/projects' },
          { label: project.client.name },
          { label: project.name },
        ]}
        title={project.name}
        description={project.description ?? PROJECT_TYPE_LABELS[project.type]}
        actions={
          mainWorkflow ? (
            <Link
              href={`/projects/${project.id}/builder/${mainWorkflow.id}`}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-md bg-accent px-3.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              <Workflow className="size-4" /> Abrir constructor
            </Link>
          ) : undefined
        }
      />

      <div className="flex-1 space-y-6 p-6">
        {/* Datos generales */}
        <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Estado</p>
            <div className="mt-1.5">
              <ProjectStatusBadge status={project.status} />
            </div>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Tipo</p>
            <p className="mt-1.5 text-sm">{PROJECT_TYPE_LABELS[project.type]}</p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Responsable</p>
            <p className="mt-1.5 text-sm">{project.owner?.name ?? '—'}</p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Creado</p>
            <p className="mt-1.5 font-mono text-sm tabular-nums">{formatDateTime(project.createdAt)}</p>
          </div>
        </section>

        {/* Flujos */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Flujos</h2>
          <div className="overflow-hidden rounded-lg border border-border">
            {project.workflows.map((workflow) => (
              <Link
                key={workflow.id}
                href={`/projects/${project.id}/builder/${workflow.id}`}
                className="flex items-center justify-between gap-3 border-b border-border bg-surface px-5 py-3.5 transition-colors last:border-b-0 hover:bg-surface-sunken/60"
              >
                <div className="flex items-center gap-3">
                  <GitBranch className="size-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {workflow.name}
                      {workflow.isMain ? (
                        <Badge variant="accent" className="ml-2">
                          principal
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-xs text-faint-foreground">editado {timeAgo(workflow.updatedAt)}</p>
                  </div>
                </div>
                <ArrowRight className="size-4 text-faint-foreground" />
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint-foreground">
            Los flujos adicionales y subflujos se habilitan al completar la Fase 2.
          </p>
        </section>

        {/* Accesos del proyecto */}
        <section className="grid gap-2 sm:grid-cols-2">
          <Link
            href={`/projects/${project.id}/tests`}
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-5 py-4 transition-colors hover:bg-surface-sunken/60"
          >
            <span className="flex items-center gap-3">
              <FlaskConical className="size-4 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Casos de prueba</span>
                <span className="block text-xs text-faint-foreground">
                  {project._count.testCases} guardados
                </span>
              </span>
            </span>
            <ArrowRight className="size-4 text-faint-foreground" />
          </Link>
          <Link
            href="/executions"
            className="flex items-center justify-between rounded-lg border border-border bg-surface px-5 py-4 transition-colors hover:bg-surface-sunken/60"
          >
            <span className="flex items-center gap-3">
              <ListChecks className="size-4 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">Ejecuciones</span>
                <span className="block text-xs text-faint-foreground">
                  {project._count.executions} registradas
                </span>
              </span>
            </span>
            <ArrowRight className="size-4 text-faint-foreground" />
          </Link>
        </section>

        {/* Entornos */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Entornos</h2>
          <div className="flex gap-2">
            {project.environments.map((environment) => (
              <Badge key={environment.id} variant="outline" className="px-3 py-1 font-mono text-[11px]">
                {environment.kind}
              </Badge>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint-foreground">
            Variables y credenciales por entorno llegan en la Fase 7.
          </p>
        </section>

        {/* Roadmap honesto del proyecto */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Secciones planificadas</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {UPCOMING_SECTIONS.map((section) => (
              <div
                key={section.name}
                className="flex items-center justify-between rounded-md border border-dashed border-border px-4 py-3"
              >
                <span className="text-[13px] text-muted-foreground">{section.name}</span>
                <span className="font-mono text-[10px] tracking-wide text-faint-foreground uppercase">
                  {section.phase}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
