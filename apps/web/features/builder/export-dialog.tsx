'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, PackageOpen, Rocket } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { ExportResult } from '@/lib/types';

export function ExportDialog({
  open,
  onOpenChange,
  workflowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  const generate = useMutation({
    mutationFn: () => api.post<ExportResult>(`/workflows/${workflowId}/export`),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? `${e.message}${e.issues ? ': ' + e.issues.map((i) => i.message).join(' · ') : ''}`
          : 'No se pudo exportar.',
      ),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <DialogContent
        title="Exportar runtime"
        description="Genera un proyecto Node independiente y liviano de la versión estable, listo para desplegar."
        className="max-w-lg"
      >
        {!result ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-sunken/40 p-4 text-[13px] text-muted-foreground">
              <p className="mb-2 flex items-center gap-2 font-medium text-foreground">
                <PackageOpen className="size-4" /> Qué se genera
              </p>
              <ul className="space-y-1 text-[12px]">
                <li>· Runtime empaquetado que interpreta tu flujo (sin el editor)</li>
                <li>· Dockerfile, railway.json, .env.example y README de despliegue</li>
                <li>· Solo las integraciones que el flujo usa · sin secretos</li>
              </ul>
            </div>
            <p className="text-[12px] text-faint-foreground">
              Se exporta la versión estable (o la última publicada). Publicá una versión primero desde
              «Versiones».
            </p>
            {error ? <p className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p> : null}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => generate.mutate()} loading={generate.isPending}>
                <Rocket /> Generar export
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-success/30 bg-success-soft/40 p-4">
              <p className="text-sm font-medium">✓ Export generado</p>
              <p className="mt-1 font-mono text-[12px] text-muted-foreground">
                {result.slug} · v{result.manifest.workflowVersion} · {(result.sizeBytes / 1024).toFixed(0)} KB
              </p>
            </div>

            <a
              href={`/api/exports/${result.id}/download`}
              className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              <Download className="size-4" /> Descargar ZIP
            </a>

            <div>
              <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                Carpeta local
              </p>
              <code className="block overflow-x-auto rounded-md border border-border bg-surface-sunken px-2.5 py-1.5 font-mono text-[10.5px]">
                {result.folder}
              </code>
            </div>

            {result.requiredEnvVars.length > 0 ? (
              <div>
                <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                  Variables de entorno a completar
                </p>
                <ul className="space-y-0.5">
                  {result.requiredEnvVars.map((v) => (
                    <li key={v.name} className="text-[12px]">
                      <code className="font-mono text-accent">{v.name}</code>
                      <span className="ml-1.5 text-muted-foreground">— {v.hint}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-[12px] text-muted-foreground">Este flujo no requiere variables de entorno.</p>
            )}

            <div className="rounded-md border border-border bg-surface-sunken/40 p-3 font-mono text-[11px] text-muted-foreground">
              <p className="mb-1 text-faint-foreground"># correr localmente</p>
              <p>cp .env.example .env</p>
              <p>node dist/main.js</p>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
