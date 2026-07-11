'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, FlaskConical, MoreHorizontal, Pencil, Play, Plus, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { TestCaseDialog } from '@/features/tests/test-case-dialog';
import type { EvaluateResponse, ExecutionDetail, ProjectDetail, TestCaseRow } from '@/lib/types';

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);

async function runAndEvaluate(testCase: TestCaseRow): Promise<EvaluateResponse> {
  const { executionId } = await api.post<{ executionId: string }>(`/test-cases/${testCase.id}/run`);
  for (;;) {
    const execution = await api.get<ExecutionDetail>(`/executions/${executionId}`);
    if (TERMINAL.has(execution.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  return api.post<EvaluateResponse>(`/test-cases/${testCase.id}/evaluate`, { executionId });
}

export default function TestCasesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TestCaseRow | undefined>(undefined);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());
  const [runningAll, setRunningAll] = useState(false);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
  });
  const cases = useQuery({
    queryKey: ['test-cases', projectId],
    queryFn: () => api.get<TestCaseRow[]>(`/projects/${projectId}/test-cases`),
  });

  const mainWorkflowId =
    project.data?.workflows.find((w) => w.isMain)?.id ?? project.data?.workflows[0]?.id ?? '';

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['test-cases', projectId] });

  const runOne = async (testCase: TestCaseRow) => {
    setRunningIds((current) => new Set(current).add(testCase.id));
    try {
      await runAndEvaluate(testCase);
    } finally {
      setRunningIds((current) => {
        const next = new Set(current);
        next.delete(testCase.id);
        return next;
      });
      refresh();
    }
  };

  const runAll = async () => {
    if (!cases.data) return;
    setRunningAll(true);
    try {
      for (const testCase of cases.data) {
        await runOne(testCase);
      }
    } finally {
      setRunningAll(false);
    }
  };

  const remove = useMutation({
    mutationFn: (testCase: TestCaseRow) => api.delete(`/test-cases/${testCase.id}`),
    onSuccess: refresh,
  });
  const duplicate = useMutation({
    mutationFn: (testCase: TestCaseRow) => api.post(`/test-cases/${testCase.id}/duplicate`),
    onSuccess: refresh,
  });

  const list = cases.data ?? [];
  const passed = list.filter((c) => c.lastRunStatus === 'PASSED').length;
  const failed = list.filter((c) => c.lastRunStatus === 'FAILED').length;

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Proyectos', href: '/projects' },
          { label: project.data?.name ?? '…', href: `/projects/${projectId}` },
          { label: 'Casos de prueba' },
        ]}
        title="Casos de prueba"
        description={
          list.length > 0
            ? `${list.length} casos · ${passed} pasando · ${failed} fallando`
            : 'Entradas guardadas con su resultado esperado, para verificar el flujo tras cada cambio.'
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => void runAll()} loading={runningAll} disabled={list.length === 0}>
              <Play /> Ejecutar todos
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setDialogOpen(true);
              }}
              disabled={!mainWorkflowId}
            >
              <Plus /> Nuevo caso
            </Button>
          </>
        }
      />

      <div className="flex-1 space-y-3 p-6">
        {cases.isLoading || project.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : cases.isError ? (
          <ErrorState message="No se pudieron cargar los casos." retry={() => void cases.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<FlaskConical />}
            title="Todavía no hay casos de prueba"
            description='Creá uno acá o desde el constructor con "Guardar caso" después de una ejecución.'
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(undefined);
                  setDialogOpen(true);
                }}
              >
                <Plus /> Nuevo caso
              </Button>
            }
          />
        ) : (
          <ol className="space-y-2">
            {list.map((testCase) => {
              const running = runningIds.has(testCase.id);
              const results = testCase.lastRunDetail?.results ?? [];
              return (
                <li key={testCase.id} className="overflow-hidden rounded-lg border border-border bg-surface">
                  <details>
                    <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 select-none hover:bg-surface-sunken/50">
                      {running ? (
                        <Badge variant="accent" dot>
                          ejecutando…
                        </Badge>
                      ) : testCase.lastRunStatus === 'PASSED' ? (
                        <Badge variant="success" dot>
                          Pasa
                        </Badge>
                      ) : testCase.lastRunStatus === 'FAILED' ? (
                        <Badge variant="danger" dot>
                          Falla
                        </Badge>
                      ) : (
                        <Badge variant="neutral" dot>
                          Sin correr
                        </Badge>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium">{testCase.name}</p>
                        {testCase.description ? (
                          <p className="truncate text-[11px] text-faint-foreground">{testCase.description}</p>
                        ) : null}
                      </div>
                      <span className="font-mono text-[11px] text-faint-foreground tabular-nums">
                        {testCase.assertions.length} assertions
                        {testCase.lastRunAt ? ` · ${timeAgo(testCase.lastRunAt)}` : ''}
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={running}
                        onClick={(event) => {
                          event.preventDefault();
                          void runOne(testCase);
                        }}
                      >
                        <Play /> Ejecutar
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Acciones para ${testCase.name}`}
                            onClick={(event) => event.preventDefault()}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(testCase);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil /> Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => duplicate.mutate(testCase)}>
                            <Copy /> Duplicar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-danger data-[highlighted]:bg-danger-soft"
                            onSelect={() => remove.mutate(testCase)}
                          >
                            <Trash2 /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </summary>

                    <div className="space-y-3 border-t border-border px-4 py-3">
                      <div>
                        <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                          Entrada
                        </p>
                        <pre className="max-h-32 overflow-auto rounded-md border border-border bg-surface-sunken p-2 font-mono text-[10.5px]">
                          {JSON.stringify(testCase.input, null, 2)}
                        </pre>
                      </div>
                      {results.length > 0 ? (
                        <div>
                          <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                            Último resultado
                            {testCase.lastRunDetail?.executionId ? (
                              <Link
                                href={`/executions/${testCase.lastRunDetail.executionId}`}
                                className="ml-2 font-mono text-accent normal-case hover:underline"
                              >
                                ver ejecución →
                              </Link>
                            ) : null}
                          </p>
                          <ul className="space-y-1">
                            {results.map((result, index) => (
                              <li key={index} className="flex items-start gap-2 text-[12px]">
                                {result.passed ? (
                                  <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
                                ) : (
                                  <X className="mt-0.5 size-3.5 shrink-0 text-danger" />
                                )}
                                <span className={result.passed ? 'text-muted-foreground' : 'text-danger'}>
                                  {result.message}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : (
                        <p className="text-[12px] text-faint-foreground">Este caso todavía no se ejecutó.</p>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {mainWorkflowId ? (
        <TestCaseDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          projectId={projectId}
          workflowId={editing?.workflowId ?? mainWorkflowId}
          testCase={editing}
        />
      ) : null}
    </>
  );
}
