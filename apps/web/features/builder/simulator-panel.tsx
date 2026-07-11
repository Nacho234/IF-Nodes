'use client';

import { useEffect, useRef, useState } from 'react';
import { RotateCcw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useBuilderStore } from './store';
import type { ExecutionDetail } from '@/lib/types';

interface ChatMessage {
  id: string;
  from: 'client' | 'bot' | 'system';
  text: string;
  executionId?: string;
}

/**
 * Simulador de conversación de WhatsApp. Cada mensaje dispara una ejecución
 * real del flujo (mismo formato interno que usará el proveedor real de
 * WhatsApp Cloud); la respuesta del bot es la salida del nodo Respuesta.
 * MVP: cada mensaje es una ejecución independiente (la memoria de
 * conversación llega con las entidades de Conversación en fases siguientes).
 */
export function SimulatorPanel({
  onSend,
  onClose,
}: {
  /** Ejecuta el flujo con el input dado y resuelve con la ejecución terminal */
  onSend: (input: Record<string, unknown>) => Promise<ExecutionDetail>;
  onClose: () => void;
}) {
  const nodeTypes = useBuilderStore((state) => state.nodeTypes);
  const nodes = useBuilderStore((state) => state.nodes);
  const [name, setName] = useState('Cliente de prueba');
  const [phone, setPhone] = useState('5493410000000');
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const hasWhatsAppTrigger = nodes.some(
    (node) => node.type === 'ifn' && node.data.nodeType === 'trigger.whatsapp-message' && !node.data.disabled,
  );
  const knowsWhatsAppTrigger = nodeTypes.has('trigger.whatsapp-message');

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, busy]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    setBusy(true);
    const messageId = Math.random().toString(36).slice(2);
    setMessages((current) => [...current, { id: messageId, from: 'client', text }]);
    try {
      const execution = await onSend({ text, phone, name, messageType: 'text', channel: 'whatsapp' });
      const reply = (execution.context?.finalOutput as { message?: string } | undefined)?.message;
      if (execution.status === 'SUCCEEDED' && typeof reply === 'string') {
        setMessages((current) => [
          ...current,
          { id: `${messageId}-r`, from: 'bot', text: reply, executionId: execution.id },
        ]);
      } else if (execution.status === 'SUCCEEDED') {
        setMessages((current) => [
          ...current,
          {
            id: `${messageId}-r`,
            from: 'system',
            text: 'El flujo terminó sin un nodo Respuesta en esta rama (no hay mensaje para el cliente).',
            executionId: execution.id,
          },
        ]);
      } else {
        setMessages((current) => [
          ...current,
          {
            id: `${messageId}-r`,
            from: 'system',
            text: `La ejecución terminó en ${execution.status}${execution.error ? `: ${execution.error.message}` : ''}. Revisá el nodo marcado en rojo.`,
            executionId: execution.id,
          },
        ]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `${messageId}-r`,
          from: 'system',
          text: error instanceof Error ? error.message : 'No se pudo ejecutar el flujo.',
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="flex w-80 shrink-0 flex-col border-l border-border bg-surface"
      aria-label="Simulador de WhatsApp"
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-[13px] font-semibold">Simulador</p>
          <p className="text-[10px] text-faint-foreground">conversación de WhatsApp · sin cuenta real</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Cerrar simulador" onClick={onClose}>
          <X />
        </Button>
      </header>

      {/* Escenario */}
      <div className="grid grid-cols-2 gap-2 border-b border-border px-4 py-3">
        <div className="space-y-1">
          <Label htmlFor="sim-name">Nombre</Label>
          <Input id="sim-name" value={name} onChange={(e) => setName(e.target.value)} className="h-7.5 text-xs" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sim-phone">Teléfono</Label>
          <Input id="sim-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="h-7.5 font-mono text-xs" />
        </div>
      </div>

      {!hasWhatsAppTrigger && knowsWhatsAppTrigger ? (
        <p className="mx-4 mt-3 rounded-md bg-warning-soft px-3 py-2 text-[11.5px] text-warning">
          El flujo no tiene un nodo <strong>Mensaje de WhatsApp</strong> activo: el mensaje va a entrar por el
          disparador que exista. Agregalo desde la biblioteca para simular WhatsApp de verdad.
        </p>
      ) : null}

      {/* Conversación */}
      <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <p className="mt-6 text-center text-[12px] text-faint-foreground">
            Escribí como si fueras el cliente.
            <br />
            Cada mensaje ejecuta el flujo y podés ver el recorrido en el lienzo.
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={cn('flex', message.from === 'client' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-lg px-3 py-1.5 text-[12.5px] leading-4.5 whitespace-pre-wrap',
                  message.from === 'client' && 'bg-accent text-accent-foreground',
                  message.from === 'bot' && 'border border-border bg-surface-raised',
                  message.from === 'system' && 'w-full bg-warning-soft text-[11.5px] text-warning',
                )}
              >
                {message.text}
                {message.executionId ? (
                  <a
                    href={`/executions/${message.executionId}`}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      'mt-1 block font-mono text-[9.5px] underline-offset-2 hover:underline',
                      message.from === 'client' ? 'text-accent-foreground/70' : 'text-faint-foreground',
                    )}
                  >
                    ver ejecución →
                  </a>
                ) : null}
              </div>
            </div>
          ))
        )}
        {busy ? (
          <div className="flex justify-start">
            <div className="rounded-lg border border-border bg-surface-raised px-3 py-2">
              <span className="flex gap-1" aria-label="El bot está escribiendo">
                <span className="size-1.5 animate-bounce rounded-full bg-faint-foreground [animation-delay:0ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-faint-foreground [animation-delay:120ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-faint-foreground [animation-delay:240ms]" />
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Composer */}
      <form onSubmit={send} className="flex items-center gap-1.5 border-t border-border p-3">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Reiniciar conversación"
          title="Reiniciar conversación"
          onClick={() => setMessages([])}
        >
          <RotateCcw />
        </Button>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Escribí un mensaje…"
          aria-label="Mensaje del cliente"
          disabled={busy}
        />
        <Button type="submit" variant="primary" size="icon" aria-label="Enviar" disabled={!draft.trim() || busy}>
          <Send />
        </Button>
      </form>
    </aside>
  );
}
