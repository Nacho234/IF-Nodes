'use client';

import Link from 'next/link';
import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Check, MinusCircle, RotateCcw, Workflow, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { ExecutionStatusBadge } from '@/components/execution-status-badge';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import type { ExecutionDetail } from '@/lib/types';

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-56 overflow-auto rounded-md border border-border bg-surface-sunken p-2.5 font-mono text-[11px] leading-4.5 whitespace-pre-wrap">
      {value === undefined || value === null ? '—' : JSON.stringify(value, null, 2)}
    </pre>
  );
}

const STEP_ICON = {
  SUCCEEDED: <Check className="size-3.5 text-success" />,
  FAILED: <X className="size-3.5 text-danger" />,
  SKIPPED: <MinusCircle className="size-3.5 text-faint-foreground" />,
} as Record<string, React.ReactNode>;

export default function ExecutionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const execution = useQuery({
    queryKey: ['execution', id],
    queryFn: () => api.get<ExecutionDetail>(`/executions/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'QUEUED' || status === 'RUNNING' ? 1000 : false;
    },
  });

  const retry = useMutation({
    mutationFn: () => api.post<{ executionId: string }>(`/executions/${id}/retry`),
    onSuccess: ({ executionId }) => {
      void queryClient.invalidateQueries({ queryKey: ['executions'] });
      router.push(`/executions/${executionId}`);
    },
  });

  if (execution.isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (execution.isError || !execution.data) {
    return (
      <div className="p-6">
        <ErrorState message="No se pudo cargar la ejecución." retry={() => void execution.refetch()} />
      </div>
    );
  }

  const data = execution.data;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Ejecuciones', href: '/executions' },
          { label: data.project.name, href: `/projects/${data.projectId}` },
          { label: `#${data.id.slice(-8)}` },
        ]}
        title={`Ejecución de «${data.workflow.name}»`}
        description={`${data.triggerType} · ${data.version ? `versión v${data.version.number}` : 'borrador'} · ${data.environment}`}
        actions={
          <>
            <Link
              href={`/projects/${data.projectId}/builder/${data.workflowId}`}
              className="inline-flex h-8.5 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3.5 text-sm font-medium hover:bg-surface-sunken"
            >
              <Workflow className="size-4" /> Abrir constructor
            </Link>
            <Button variant="primary" onClick={() => retry.mutate()} loading={retry.isPending}>
              <RotateCcw /> Reintentar
            </Button>
          </>
        }
      />

      <div className="flex-1 space-y-6 p-6">
        {/* Resumen */}
        <section className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Estado</p>
            <div className="mt-1.5">
              <ExecutionStatusBadge status={data.status} />
            </div>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Inicio</p>
            <p className="mt-1.5 font-mono text-sm tabular-nums">
              {data.startedAt ? formatDateTime(data.startedAt) : '—'}
            </p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Duración</p>
            <p className="mt-1.5 font-mono text-sm tabular-nums">
              {data.durationMs !== null ? `${data.durationMs} ms` : '—'}
            </p>
          </div>
          <div className="bg-surface px-5 py-4">
            <p className="text-[11px] font-medium tracking-wide text-faint-foreground uppercase">Pasos</p>
            <p className="mt-1.5 font-mono text-sm tabular-nums">{data.steps.length}</p>
          </div>
        </section>

        {/* Error global */}
        {data.error ? (
          <section className="rounded-lg border border-danger/40 bg-danger-soft/50 px-5 py-4">
            <p className="text-[11px] font-semibold tracking-wide text-danger uppercase">
              Error {data.failedNodeId ? `· nodo ${data.failedNodeId}` : ''}
            </p>
            <p className="mt-1 text-sm text-danger">
              <code className="font-mono text-xs">{data.error.code}</code> — {data.error.message}
            </p>
          </section>
        ) : null}

        {/* Pasos */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Recorrido por nodo</h2>
          <ol className="space-y-2">
            {data.steps.map((step) => (
              <li key={step.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                <details>
                  <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 select-none hover:bg-surface-sunken/50">
                    <span className="font-mono text-[11px] text-faint-foreground tabular-nums">
                      {String(step.order + 1).padStart(2, '0')}
                    </span>
                    {STEP_ICON[step.status] ?? <MinusCircle className="size-3.5 text-faint-foreground" />}
                    <span className="text-[13px] font-medium">{step.nodeName}</span>
                    <code className="rounded bg-surface-sunken px-1.5 py-px font-mono text-[10px] text-muted-foreground">
                      {step.nodeType}
                    </code>
                    <span className="ml-auto flex items-center gap-3 font-mono text-[11px] text-faint-foreground tabular-nums">
                      {step.attempt > 1 ? <span>intento {step.attempt}</span> : null}
                      <span>{step.durationMs ?? 0} ms</span>
                    </span>
                  </summary>
                  <div className="grid gap-3 border-t border-border px-4 py-3 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                        Entrada
                      </p>
                      <JsonBlock value={step.input} />
                    </div>
                    <div>
                      <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                        Salida
                      </p>
                      <JsonBlock value={step.output} />
                    </div>
                    {step.error ? (
                      <div className="lg:col-span-2">
                        <p className="mb-1 text-[10px] font-semibold tracking-widest text-danger uppercase">Error</p>
                        <p className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">
                          <code className="font-mono text-[11px]">{step.error.code}</code> — {step.error.message}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        </section>

        {/* Resultado final y logs */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-2 text-sm font-semibold">Disparador</h2>
            <JsonBlock value={data.triggerData} />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-semibold">Salida final</h2>
            <JsonBlock value={data.context?.finalOutput} />
          </div>
        </section>

        {data.logs.length > 0 ? (
          <section>
            <h2 className="mb-2 text-sm font-semibold">Logs</h2>
            <div className="max-h-64 overflow-auto rounded-lg border border-border bg-surface-sunken p-3 font-mono text-[11px] leading-5">
              {data.logs.map((log) => (
                <p key={log.id}>
                  <span
                    className={
                      log.level === 'ERROR'
                        ? 'text-danger'
                        : log.level === 'WARN'
                          ? 'text-warning'
                          : 'text-faint-foreground'
                    }
                  >
                    [{log.level}]
                  </span>{' '}
                  {log.nodeId ? <span className="text-accent">{log.nodeId}</span> : null} {log.message}
                </p>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}
