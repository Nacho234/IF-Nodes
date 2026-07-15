'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface BuildResult {
  ok: boolean;
  message?: string;
  summary?: string;
  flows?: { id: string; name: string }[];
  knowledgeAdded?: number;
}

/**
 * Fase 3: le pedís al Copilot que arme el agente entero (varios flujos +
 * conocimiento) de una descripción. El backend valida y crea todo; los secretos
 * los cargás vos después (te guía "Puesta en marcha").
 */
export function BuildProjectButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BuildResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const build = async () => {
    if (!description.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<BuildResult>(`/copilot/projects/${projectId}/build`, { description });
      setResult(res);
      if (res.ok) router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No se pudo armar el proyecto.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Sparkles /> Generar con IA
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title="Generar agente con IA"
          description="Describí el agente y el Copilot arma los flujos + el conocimiento. Los secretos los cargás vos después."
        >
          {result?.ok ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-[13px] text-success">
                <CheckCircle2 className="size-4" /> {result.summary}
              </div>
              <div>
                <p className="mb-1.5 text-[12px] font-medium">Flujos creados</p>
                <div className="space-y-1">
                  {(result.flows ?? []).map((flow) => (
                    <Link
                      key={flow.id}
                      href={`/projects/${projectId}/builder/${flow.id}`}
                      className="flex items-center justify-between rounded-md border border-border bg-surface px-3 py-2 text-[12.5px] hover:bg-surface-sunken/60"
                      onClick={() => setOpen(false)}
                    >
                      {flow.name} <span className="text-[11px] text-accent">Abrir constructor →</span>
                    </Link>
                  ))}
                </div>
              </div>
              {result.knowledgeAdded ? (
                <p className="text-[11.5px] text-muted-foreground">+ {result.knowledgeAdded} fragmentos de conocimiento sembrados.</p>
              ) : null}
              <p className="rounded-md bg-surface-sunken/50 px-3 py-2 text-[11.5px] text-muted-foreground">
                Revisá cada flujo, cargá las <strong>credenciales</strong> y el <strong>conocimiento</strong> que falte
                (el botón <strong>Puesta en marcha</strong> del constructor te dice qué). Los secretos los ponés vos.
              </p>
              <Button variant="secondary" size="sm" onClick={() => { setResult(null); setDescription(''); }}>
                Generar otro
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ej: Un agente para un festival de cine que conversa por WhatsApp con memoria y tono cercano, hace campañas de outreach por WhatsApp y email, detecta intención de reunión y deriva a un operador humano."
                className="min-h-32"
                disabled={busy}
              />
              {result && !result.ok ? (
                <p className="text-[12px] text-warning">{result.message}</p>
              ) : null}
              {error ? <p className="text-[12px] text-danger">{error}</p> : null}
              <p className="text-[11px] text-faint-foreground">
                Arma varios flujos de una (uno por punto de entrada). Necesita Claude real (API key). Puede tardar unos segundos.
              </p>
              <div className="flex justify-end">
                <Button variant="primary" size="sm" onClick={() => void build()} loading={busy} disabled={!description.trim()}>
                  <Sparkles /> Generar
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
