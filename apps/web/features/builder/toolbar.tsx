'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, Check, CircleAlert, Loader2, ShieldCheck } from 'lucide-react';
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

/** Barra superior del constructor: contexto, estado de guardado y validación. */
export function BuilderToolbar({
  workflow,
  onValidate,
  onSaveNow,
  validating,
}: {
  workflow: WorkflowDetail;
  onValidate: () => void;
  onSaveNow: () => void;
  validating: boolean;
}) {
  const saveState = useBuilderStore((state) => state.saveState);
  const lastSavedAt = useBuilderStore((state) => state.lastSavedAt);
  const structureIssues = useBuilderStore((state) => state.structureIssues);
  const configIssues = useBuilderStore((state) => state.configIssues);

  const errors = structureIssues.filter((issue) => issue.level === 'error');
  const warnings = structureIssues.filter((issue) => issue.level === 'warning');
  const totalIssues = structureIssues.length + configIssues.length;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-3">
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

        <Button variant="secondary" size="sm" onClick={onValidate} loading={validating}>
          <ShieldCheck /> Validar
        </Button>

        <Tooltip content="Ejecutar y publicar llegan con el motor (Fases 3 y 8) — ver PROJECT_PLAN.md">
          <span className="cursor-help font-mono text-[10px] tracking-wide text-faint-foreground uppercase">
            motor: fase 3
          </span>
        </Tooltip>
      </div>
    </header>
  );
}
