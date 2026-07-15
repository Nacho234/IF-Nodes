'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Download, PackageCheck, Rocket, Server } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { ExportResult } from '@/lib/types';

/**
 * Opción B: exporta el PROYECTO COMPLETO (todos los flujos) como un runtime
 * autocontenido que corre en la infra del cliente. Incluye el orquestador
 * (entrada + campañas + cron), el conocimiento y la persistencia opcional.
 */
export function ExportProjectButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  const generate = useMutation({
    mutationFn: () => api.post<ExportResult>(`/projects/${projectId}/export`),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? `${e.message}${e.issues ? ': ' + e.issues.map((i) => i.message).join(' · ') : ''}`
          : 'No se pudo exportar el proyecto.',
      ),
  });

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Server /> Exportar bot
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setResult(null);
            setError(null);
          }
        }}
      >
        <DialogContent
          title="Exportar bot completo"
          description="Empaqueta TODOS los flujos del proyecto en un runtime autocontenido para desplegar en tu propia infra."
          className="max-w-lg"
        >
          {!result ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-surface-sunken/40 p-4 text-[13px] text-muted-foreground">
                <p className="mb-2 flex items-center gap-2 font-medium text-foreground">
                  <PackageCheck className="size-4" /> Qué incluye
                </p>
                <ul className="space-y-1 text-[12px]">
                  <li>· Todos los flujos + un orquestador (entrada, campañas, cron)</li>
                  <li>· Base de conocimiento (RAG) y persistencia opcional (Postgres/Supabase)</li>
                  <li>· Dockerfile, railway.json, .env.example y README · sin secretos</li>
                </ul>
              </div>
              <p className="text-[12px] text-faint-foreground">
                Usa la versión estable de cada flujo (o el borrador si no hay versión). El bot corre 100 % en
                tu stack, sin depender de IF Nodes.
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
                <p className="text-sm font-medium">✓ Bot exportado</p>
                <p className="mt-1 font-mono text-[12px] text-muted-foreground">
                  {result.slug} · {result.flows?.length ?? 0} flujos · {(result.sizeBytes / 1024).toFixed(0)} KB
                </p>
              </div>

              {result.flows && result.flows.length > 0 ? (
                <div>
                  <p className="mb-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                    Flujos incluidos
                  </p>
                  <ul className="space-y-0.5">
                    {result.flows.map((f) => (
                      <li key={f.slug} className="text-[12px]">
                        <span className="text-foreground">{f.name}</span>
                        <code className="ml-1.5 font-mono text-[11px] text-faint-foreground">{f.slug}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <a
                href={`/api/exports/${result.id}/download`}
                className="flex w-full items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
              >
                <Download className="size-4" /> Descargar ZIP
              </a>

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
                <p className="text-[12px] text-muted-foreground">Este bot no requiere variables de entorno.</p>
              )}

              <div className="rounded-md border border-border bg-surface-sunken/40 p-3 font-mono text-[11px] text-muted-foreground">
                <p className="mb-1 text-faint-foreground"># correr localmente (o Docker / Railway)</p>
                <p>cp .env.example .env</p>
                <p>node dist/main.js</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
