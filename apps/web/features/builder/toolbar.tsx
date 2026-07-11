'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CircleAlert,
  ExternalLink,
  FlaskConical,
  GitBranch,
  Loader2,
  MessageCircle,
  PackageOpen,
  Play,
  Redo2,
  ShieldCheck,
  StickyNote,
  Undo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip } from '@/components/ui/tooltip';
import { timeAgo } from '@/lib/utils';
import { useBuilderStore } from './store';
import type { WorkflowDetail } from '@/lib/types';

const RUN_STATUS_LABEL: Record<string, string> = {
  QUEUED: 'en cola',
  RUNNING: 'ejecutando…',
  SUCCEEDED: 'exitosa',
  FAILED: 'falló',
  CANCELLED: 'cancelada',
  TIMED_OUT: 'timeout',
};

/** Barra superior del constructor: contexto, guardado, validación y ejecución. */
export function BuilderToolbar({
  workflow,
  onValidate,
  onSaveNow,
  onRun,
  onAddNote,
  onToggleSimulator,
  onSaveTestCase,
  onOpenVersions,
  onOpenExport,
  simulatorOpen,
  validating,
  running,
}: {
  workflow: WorkflowDetail;
  onValidate: () => void;
  onSaveNow: () => void;
  onRun: () => void;
  onAddNote: () => void;
  onToggleSimulator: () => void;
  onSaveTestCase: () => void;
  onOpenVersions: () => void;
  onOpenExport: () => void;
  simulatorOpen: boolean;
  validating: boolean;
  running: boolean;
}) {
  const saveState = useBuilderStore((state) => state.saveState);
  const lastSavedAt = useBuilderStore((state) => state.lastSavedAt);
  const structureIssues = useBuilderStore((state) => state.structureIssues);
  const configIssues = useBuilderStore((state) => state.configIssues);
  const activeExecution = useBuilderStore((state) => state.activeExecution);
  const canUndo = useBuilderStore((state) => state.past.length > 0);
  const canRedo = useBuilderStore((state) => state.future.length > 0);
  const undo = useBuilderStore((state) => state.undo);
  const redo = useBuilderStore((state) => state.redo);

  const errors = structureIssues.filter((issue) => issue.level === 'error');
  const warnings = structureIssues.filter((issue) => issue.level === 'warning');
  const totalIssues = structureIssues.length + configIssues.length;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3">
      <Tooltip content="Volver al proyecto">
        <Link
          href={`/projects/${workflow.projectId}`}
          aria-label="Volver al proyecto"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
        </Link>
      </Tooltip>

      <div className="min-w-0">
        <p className="truncate text-[13px] leading-tight font-semibold">
          {workflow.project.name}
          <span className="mx-1.5 text-faint-foreground">/</span>
          <span className="font-normal text-muted-foreground">{workflow.name}</span>
        </p>
        <p className="text-[10px] leading-tight text-faint-foreground">
          {workflow.project.client.name} · borrador
          {workflow.versions.length > 0 ? ` · última versión v${workflow.versions[0]?.number}` : ' · sin versiones'}
        </p>
      </div>

      {/* Undo / Redo / Nota */}
      <div className="ml-2 flex items-center gap-0.5 border-l border-border pl-2">
        <Tooltip content="Deshacer (⌘Z)">
          <Button variant="ghost" size="icon-sm" aria-label="Deshacer" disabled={!canUndo} onClick={undo}>
            <Undo2 />
          </Button>
        </Tooltip>
        <Tooltip content="Rehacer (⇧⌘Z)">
          <Button variant="ghost" size="icon-sm" aria-label="Rehacer" disabled={!canRedo} onClick={redo}>
            <Redo2 />
          </Button>
        </Tooltip>
        <Tooltip content="Agregar nota al lienzo">
          <Button variant="ghost" size="icon-sm" aria-label="Agregar nota" onClick={onAddNote}>
            <StickyNote />
          </Button>
        </Tooltip>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Estado de guardado */}
        <span
          role="status"
          className="flex items-center gap-1.5 font-mono text-[11px] text-faint-foreground tabular-nums"
        >
          {saveState === 'saving' ? (
            <>
              <Loader2 className="size-3 animate-spin" /> guardando…
            </>
          ) : saveState === 'dirty' ? (
            <>
              <span className="size-1.5 rounded-full bg-warning" /> cambios sin guardar
            </>
          ) : saveState === 'error' ? (
            <span className="flex items-center gap-1.5 text-danger">
              <CircleAlert className="size-3" /> error al guardar
              <button type="button" onClick={onSaveNow} className="cursor-pointer underline">
                reintentar
              </button>
            </span>
          ) : saveState === 'saved' ? (
            <>
              <Check className="size-3 text-success" />
              guardado{lastSavedAt ? ` ${timeAgo(lastSavedAt)}` : ''}
            </>
          ) : (
            'cargando…'
          )}
        </span>

        {/* Última ejecución de prueba */}
        {activeExecution ? (
          <Link
            href={`/executions/${activeExecution.id}`}
            className="flex items-center gap-1 font-mono text-[11px] hover:underline"
          >
            <Badge
              variant={
                activeExecution.status === 'SUCCEEDED'
                  ? 'success'
                  : activeExecution.status === 'FAILED' || activeExecution.status === 'TIMED_OUT'
                    ? 'danger'
                    : 'accent'
              }
              dot
            >
              prueba {RUN_STATUS_LABEL[activeExecution.status] ?? activeExecution.status}
            </Badge>
            <ExternalLink className="size-3 text-faint-foreground" />
          </Link>
        ) : null}

        {/* Resultado de validación */}
        {totalIssues > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className="cursor-pointer">
                <Badge variant={errors.length > 0 ? 'danger' : 'warning'} className="gap-1">
                  <AlertTriangle className="size-3" />
                  {errors.length > 0 ? `${errors.length} errores` : ''}
                  {errors.length > 0 && (warnings.length > 0 || configIssues.length > 0) ? ' · ' : ''}
                  {warnings.length + configIssues.length > 0 ? `${warnings.length + configIssues.length} avisos` : ''}
                </Badge>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Resultado de la validación</DropdownMenuLabel>
              <ul className="max-h-64 space-y-1 overflow-y-auto px-2 pb-2">
                {structureIssues.map((issue, index) => (
                  <li key={`s-${index}`} className="flex gap-2 text-[12px]">
                    <span className={issue.level === 'error' ? 'text-danger' : 'text-warning'}>
                      {issue.level === 'error' ? '●' : '▲'}
                    </span>
                    <span className="text-muted-foreground">{issue.message}</span>
                  </li>
                ))}
                {configIssues.map((issue, index) => (
                  <li key={`c-${index}`} className="flex gap-2 text-[12px]">
                    <span className="text-warning">▲</span>
                    <span className="text-muted-foreground">
                      <strong>{issue.nodeName}</strong>
                      {issue.field ? (
                        <>
                          {' · '}
                          <code className="font-mono text-[11px]">{issue.field}</code>
                        </>
                      ) : null}
                      : {issue.message}
                    </span>
                  </li>
                ))}
              </ul>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {activeExecution && ['SUCCEEDED', 'FAILED'].includes(activeExecution.status) ? (
          <Tooltip content="Guardar la entrada de la última ejecución como caso de prueba">
            <Button variant="secondary" size="sm" onClick={onSaveTestCase}>
              <FlaskConical /> Guardar caso
            </Button>
          </Tooltip>
        ) : null}

        <Button variant="secondary" size="sm" onClick={onValidate} loading={validating}>
          <ShieldCheck /> Validar
        </Button>

        <Button variant="secondary" size="sm" onClick={onOpenVersions}>
          <GitBranch /> Versiones
        </Button>

        <Button variant="secondary" size="sm" onClick={onOpenExport}>
          <PackageOpen /> Exportar
        </Button>

        <Button
          variant={simulatorOpen ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggleSimulator}
          aria-pressed={simulatorOpen}
        >
          <MessageCircle /> Simulador
        </Button>

        <Button variant="primary" size="sm" onClick={onRun} loading={running}>
          <Play /> Ejecutar
        </Button>
      </div>
    </header>
  );
}
