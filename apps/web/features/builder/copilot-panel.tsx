'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Check, Plus, Settings2, Trash2, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { parseChangeSet } from '@ifnodes/copilot';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { api, ApiError } from '@/lib/api';
import { useBuilderStore } from './store';

interface ProposalChange {
  op: 'add_node' | 'add_edge' | 'update_config' | 'delete_node';
  nodeType?: string;
  name?: string;
  reason?: string;
  ref?: string;
  connectFromNodeId?: string;
  from?: string;
  to?: string;
  nodeId?: string;
}
interface Proposal {
  summary: string;
  changes: ProposalChange[];
}

interface UiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  usage?: { inputTokens: number; outputTokens: number };
  estimatedCost?: number;
  proposal?: Proposal | null;
  contextSent?: unknown;
  error?: string | null;
  streaming?: boolean;
  applied?: boolean;
  applyError?: string | null;
}

interface DbMessage {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  proposal?: Proposal | null;
  contextSent?: unknown;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  error?: string | null;
}
interface SessionResponse {
  session: { id: string };
  messages: DbMessage[];
}
interface CopilotConfig {
  provider: string;
  model: string;
  isReal: boolean;
}

function fromDb(m: DbMessage): UiMessage {
  return {
    id: m.id,
    role: m.role === 'USER' ? 'user' : 'assistant',
    content: m.content,
    proposal: m.proposal ?? null,
    contextSent: m.contextSent,
    usage: { inputTokens: m.inputTokens, outputTokens: m.outputTokens },
    estimatedCost: m.estimatedCost,
    error: m.error ?? null,
  };
}

/**
 * IF Copilot: chat contextual dentro del constructor. Fase 1 (solo lectura):
 * entiende el flujo, el nodo seleccionado y la última ejecución. Fase 2 (base):
 * puede PROPONER cambios, que se muestran acá pero no se aplican todavía.
 * Los secretos nunca salen del backend (el contexto enviado va redactado).
 */
export function CopilotPanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const selectedNodeId = useBuilderStore((state) => state.selectedNodeId);
  const nodeTypes = useBuilderStore((state) => state.nodeTypes);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [config, setConfig] = useState<CopilotConfig | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Cargar sesión + estado del proveedor al abrir
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [session, cfg] = await Promise.all([
          api.get<SessionResponse>(`/copilot/sessions?workflowId=${workflowId}`),
          api.get<CopilotConfig>('/copilot/config'),
        ]);
        if (cancelled) return;
        setSessionId(session.session.id);
        setMessages(session.messages.map(fromDb));
        setConfig(cfg);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof ApiError ? error.message : 'No se pudo abrir el copilot.');
      }
    })();
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [workflowId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const patchLast = useCallback((patch: Partial<UiMessage>) => {
    setMessages((current) => {
      if (current.length === 0) return current;
      const next = [...current];
      const last = next[next.length - 1]!;
      next[next.length - 1] = { ...last, ...patch };
      return next;
    });
  }, []);

  const send = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const content = draft.trim();
      if (!content || busy || !sessionId) return;
      setDraft('');
      setBusy(true);
      const assistantId = `pending-${Math.random().toString(36).slice(2)}`;
      setMessages((current) => [
        ...current,
        { id: `u-${assistantId}`, role: 'user', content },
        { id: assistantId, role: 'assistant', content: '', streaming: true },
      ]);

      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const response = await fetch(`/api/copilot/sessions/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-ifn-csrf': '1' },
          credentials: 'same-origin',
          body: JSON.stringify({ content, selectedNodeId: selectedNodeId ?? undefined }),
          signal: abort.signal,
        });
        if (!response.ok || !response.body) {
          const body = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `Error ${response.status}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf('\n\n')) !== -1) {
            const rawEvent = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type === 'text') {
              setMessages((current) => {
                const next = [...current];
                const last = next[next.length - 1]!;
                next[next.length - 1] = { ...last, content: last.content + String(evt.delta ?? '') };
                return next;
              });
            } else if (evt.type === 'done') {
              patchLast({
                streaming: false,
                usage: evt.usage as UiMessage['usage'],
                estimatedCost: evt.estimatedCost as number,
                proposal: (evt.proposal as Proposal | null) ?? null,
              });
            } else if (evt.type === 'error') {
              patchLast({ streaming: false, error: String(evt.message ?? 'Error del copilot.') });
            }
          }
        }
      } catch (error) {
        if (abort.signal.aborted) {
          patchLast({ streaming: false });
        } else {
          patchLast({ streaming: false, error: error instanceof Error ? error.message : 'Error del copilot.' });
        }
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    },
    [draft, busy, sessionId, selectedNodeId, patchLast],
  );

  const reset = useCallback(async () => {
    if (!sessionId || busy) return;
    await api.post(`/copilot/sessions/${sessionId}/reset`).catch(() => undefined);
    setMessages([]);
  }, [sessionId, busy]);

  const patchMessage = useCallback((id: string, patch: Partial<UiMessage>) => {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const applyProposal = useCallback(
    (message: UiMessage) => {
      if (!message.proposal) return;
      const parsed = parseChangeSet(message.proposal);
      if (!parsed.ok) {
        patchMessage(message.id, { applyError: `Propuesta inválida: ${parsed.error}` });
        return;
      }
      const result = useBuilderStore.getState().applyProposal(parsed.changeSet);
      if (result.ok) {
        patchMessage(message.id, { applied: true, applyError: null });
      } else {
        patchMessage(message.id, { applyError: result.errors?.join('; ') ?? 'No se pudo aplicar.' });
      }
    },
    [patchMessage],
  );

  const nodeLabel = (type?: string) => (type ? (nodeTypes.get(type)?.displayName ?? type) : 'nodo');

  return (
    <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-surface" aria-label="IF Copilot">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-accent" />
          <div>
            <p className="text-[13px] font-semibold">IF Copilot</p>
            <p className="text-[10px] text-faint-foreground">
              {config
                ? config.isReal
                  ? `${config.model} · lee el flujo (sin secretos)`
                  : 'modo desarrollo · configurá la API key de Claude'
                : 'conectando…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" aria-label="Nuevo chat" title="Nuevo chat" onClick={() => void reset()}>
            <RotateCcw />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Cerrar copilot" onClick={onClose}>
            <X />
          </Button>
        </div>
      </header>

      {config && !config.isReal ? (
        <p className="mx-4 mt-3 rounded-md bg-warning-soft px-3 py-2 text-[11.5px] text-warning">
          El copilot responde en <strong>modo desarrollo</strong> (sin IA real). Definí{' '}
          <code className="font-mono text-[10.5px]">ANTHROPIC_API_KEY</code> en el <code>.env</code> para que piense con
          Claude.
        </p>
      ) : null}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {loadError ? (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-[12px] text-danger">{loadError}</p>
        ) : messages.length === 0 ? (
          <div className="mt-6 text-center text-[12px] text-faint-foreground">
            <Bot className="mx-auto mb-2 size-6 opacity-60" />
            Preguntale al copilot sobre el flujo.
            <br />
            Puede explicar qué hace, revisar un nodo o la última ejecución, y proponer cambios.
            {selectedNodeId ? <p className="mt-2 text-accent">Tenés un nodo seleccionado: lo va a tener en cuenta.</p> : null}
          </div>
        ) : (
          messages.map((message) => (
            <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[88%] rounded-lg px-3 py-2 text-[12.5px] leading-5 whitespace-pre-wrap',
                  message.role === 'user' ? 'bg-accent text-accent-foreground' : 'border border-border bg-surface-raised',
                )}
              >
                {message.content || (message.streaming ? '…' : '')}

                {message.error ? (
                  <p className="mt-1 rounded bg-danger-soft px-2 py-1 text-[11px] text-danger">{message.error}</p>
                ) : null}

                {message.proposal ? (
                  <div className="mt-2 rounded-md border border-accent/40 bg-accent-soft/40 p-2">
                    <p className="flex items-center gap-1 text-[11.5px] font-semibold text-accent">
                      <Sparkles className="size-3" /> Propuesta
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">{message.proposal.summary}</p>
                    <ul className="mt-1.5 space-y-1">
                      {message.proposal.changes.map((change, i) => (
                        <li key={i} className="flex gap-1.5 text-[11.5px]">
                          {change.op === 'add_node' ? (
                            <>
                              <Plus className="mt-0.5 size-3 shrink-0 text-success" />
                              <span>
                                <span className="font-medium">{nodeLabel(change.nodeType)}</span>
                                {change.name ? <span className="text-faint-foreground"> “{change.name}”</span> : null}
                                {change.reason ? <span className="block text-faint-foreground">{change.reason}</span> : null}
                              </span>
                            </>
                          ) : change.op === 'add_edge' ? (
                            <>
                              <ArrowRight className="mt-0.5 size-3 shrink-0 text-accent" />
                              <span className="text-muted-foreground">
                                conectar <code className="font-mono text-[10px]">{change.from}</code> →{' '}
                                <code className="font-mono text-[10px]">{change.to}</code>
                              </span>
                            </>
                          ) : change.op === 'update_config' ? (
                            <>
                              <Settings2 className="mt-0.5 size-3 shrink-0 text-warning" />
                              <span className="text-muted-foreground">
                                configurar <code className="font-mono text-[10px]">{change.nodeId}</code>
                                {change.reason ? <span className="block text-faint-foreground">{change.reason}</span> : null}
                              </span>
                            </>
                          ) : (
                            <>
                              <Trash2 className="mt-0.5 size-3 shrink-0 text-danger" />
                              <span className="text-muted-foreground">
                                eliminar <code className="font-mono text-[10px]">{change.nodeId}</code>
                              </span>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>

                    {message.applied ? (
                      <p className="mt-2 flex items-center gap-1 text-[11px] text-success">
                        <Check className="size-3" /> Aplicada al flujo — revisala en el lienzo (⌘Z para deshacer).
                      </p>
                    ) : (
                      <div className="mt-2">
                        <Button size="sm" variant="primary" className="h-7 w-full" onClick={() => applyProposal(message)}>
                          <Sparkles /> Aplicar propuesta
                        </Button>
                        {message.applyError ? (
                          <p className="mt-1 text-[10.5px] text-danger">{message.applyError}</p>
                        ) : null}
                        <p className="mt-1 text-[9.5px] text-faint-foreground">
                          Se aplica al borrador y se guarda solo; podés deshacer con ⌘Z.
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}

                {message.role === 'assistant' && message.usage && !message.streaming ? (
                  <p className="mt-1 font-mono text-[9.5px] text-faint-foreground tabular-nums">
                    {message.usage.inputTokens}→{message.usage.outputTokens} tok
                    {message.estimatedCost ? ` · ~$${message.estimatedCost.toFixed(4)}` : ''}
                  </p>
                ) : null}

                {message.role === 'user' && message.contextSent ? (
                  <details className="mt-1 text-accent-foreground/80">
                    <summary className="cursor-pointer text-[9.5px]">ver contexto enviado (redactado)</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-black/20 p-1.5 text-[9px] leading-tight whitespace-pre-wrap">
                      {JSON.stringify(message.contextSent, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <form onSubmit={send} className="flex items-center gap-1.5 border-t border-border p-3">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Preguntale al copilot…"
          aria-label="Mensaje al copilot"
          disabled={busy || !sessionId}
        />
        <Button
          type="submit"
          variant="primary"
          size="icon"
          aria-label="Enviar"
          disabled={!draft.trim() || busy || !sessionId}
        >
          <Send />
        </Button>
      </form>
    </aside>
  );
}
