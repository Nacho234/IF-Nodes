'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GitCompare, RotateCcw, Star, Upload } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { Badge } from '@/components/ui/badge';
import type { CompareResponse, VersionRow } from '@/lib/types';

export function VersionsDialog({
  open,
  onOpenChange,
  workflowId,
  onRestored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
  onRestored: () => void;
}) {
  const queryClient = useQueryClient();
  const [description, setDescription] = useState('');
  const [markStable, setMarkStable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparison, setComparison] = useState<CompareResponse | null>(null);

  const versions = useQuery({
    queryKey: ['versions', workflowId],
    queryFn: () => api.get<VersionRow[]>(`/workflows/${workflowId}/versions`),
    enabled: open,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['versions', workflowId] });

  const publish = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: number }>(`/workflows/${workflowId}/versions`, {
        description,
        markStable,
      }),
    onSuccess: () => {
      setDescription('');
      setMarkStable(false);
      setError(null);
      invalidate();
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? `${e.message}${e.issues ? ': ' + e.issues.map((i) => i.message).join(' · ') : ''}`
          : 'No se pudo publicar.',
      ),
  });

  const stable = useMutation({
    mutationFn: (id: string) => api.post(`/versions/${id}/stable`),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (id: string) => api.post<{ restoredFrom: number }>(`/versions/${id}/restore`),
    onSuccess: () => {
      onRestored();
      onOpenChange(false);
    },
  });
  const compare = useMutation({
    mutationFn: (id: string) =>
      api.get<CompareResponse>(`/workflows/${workflowId}/versions/compare?from=${id}&to=draft`),
    onSuccess: (data) => setComparison(data),
  });

  const list = versions.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Versiones del flujo"
        description="Publicar crea una versión inmutable del borrador actual. Las ejecuciones guardan qué versión usaron."
        className="max-w-xl"
      >
        {/* Publicar */}
        <div className="space-y-3 rounded-lg border border-border bg-surface-sunken/40 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="ver-desc">Nota de publicación (opcional)</Label>
            <Input
              id="ver-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Qué cambió en esta versión…"
            />
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch id="ver-stable" checked={markStable} onCheckedChange={setMarkStable} />
              <Label htmlFor="ver-stable" className="cursor-pointer">
                Marcar como estable
              </Label>
            </div>
            <Button variant="primary" size="sm" onClick={() => publish.mutate()} loading={publish.isPending}>
              <Upload /> Publicar versión
            </Button>
          </div>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>

        {/* Comparación */}
        {comparison ? (
          <div className="mt-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-3 text-[12px]">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-medium">
                {comparison.from} → {comparison.to}
              </span>
              <button
                type="button"
                onClick={() => setComparison(null)}
                className="cursor-pointer text-faint-foreground hover:text-foreground"
              >
                cerrar
              </button>
            </div>
            {!comparison.diff.hasChanges ? (
              <p className="text-muted-foreground">Sin diferencias funcionales.</p>
            ) : (
              <ul className="space-y-0.5 text-muted-foreground">
                {comparison.diff.nodesAdded.map((n) => (
                  <li key={`a${n.id}`} className="text-success">+ nodo «{n.name}»</li>
                ))}
                {comparison.diff.nodesRemoved.map((n) => (
                  <li key={`r${n.id}`} className="text-danger">− nodo «{n.name}»</li>
                ))}
                {comparison.diff.nodesModified.map((n) => (
                  <li key={`m${n.id}`}>~ «{n.name}»: {n.changes.join(', ')}</li>
                ))}
                {comparison.diff.edgesAdded > 0 ? <li className="text-success">+ {comparison.diff.edgesAdded} conexión(es)</li> : null}
                {comparison.diff.edgesRemoved > 0 ? <li className="text-danger">− {comparison.diff.edgesRemoved} conexión(es)</li> : null}
              </ul>
            )}
          </div>
        ) : null}

        {/* Historial */}
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-semibold tracking-widest text-faint-foreground uppercase">
            Historial
          </h3>
          {versions.isLoading ? (
            <p className="text-[12px] text-faint-foreground">Cargando…</p>
          ) : list.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[12px] text-faint-foreground">
              Todavía no publicaste ninguna versión.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {list.map((version) => (
                <li
                  key={version.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <span className="font-mono text-[13px] font-semibold tabular-nums">v{version.number}</span>
                  {version.isStable ? (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="size-3" /> estable
                    </Badge>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px]">{version.description || <span className="text-faint-foreground">sin nota</span>}</p>
                    <p className="text-[10px] text-faint-foreground">
                      {version.createdBy?.name ?? '—'} · {timeAgo(version.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Comparar con el borrador"
                      aria-label="Comparar con el borrador"
                      onClick={() => compare.mutate(version.id)}
                    >
                      <GitCompare />
                    </Button>
                    {!version.isStable ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Marcar como estable"
                        aria-label="Marcar como estable"
                        onClick={() => stable.mutate(version.id)}
                      >
                        <Star />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="Restaurar al borrador"
                      aria-label="Restaurar al borrador"
                      onClick={() => restore.mutate(version.id)}
                    >
                      <RotateCcw />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
