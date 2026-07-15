'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, timeAgo } from '@/lib/utils';
import type { ProjectDetail } from '@/lib/types';

interface ConversationRow {
  id: string;
  channel: string;
  contact: string;
  status: string;
  lastMessageAt: string;
  _count: { messages: number };
}
interface MessageRow {
  id: string;
  role: string;
  text: string;
  createdAt: string;
}

const ROLE_LABEL: Record<string, string> = { user: 'Cliente', assistant: 'Bot', system: 'Sistema' };

export default function InboxPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('handoff');
  const [selected, setSelected] = useState<string | null>(null);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
  });
  const conversations = useQuery({
    queryKey: ['conversations', projectId, status],
    queryFn: () => api.get<ConversationRow[]>(`/projects/${projectId}/conversations?status=${status}`),
  });
  const messages = useQuery({
    queryKey: ['conversation-messages', selected],
    queryFn: () => api.get<MessageRow[]>(`/conversations/${selected}/messages`),
    enabled: Boolean(selected),
  });

  const setConvStatus = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      api.patch(`/conversations/${id}/status`, { status: next }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations', projectId] });
    },
  });

  const selectedConv = conversations.data?.find((c) => c.id === selected);

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Proyectos', href: '/projects' },
          { label: project.data?.name ?? '…', href: `/projects/${projectId}` },
          { label: 'Bandeja' },
        ]}
        title="Bandeja de operador"
        description="Conversaciones que el bot derivó a una persona (handoff), con su historial."
      />

      <div className="flex min-h-0 flex-1">
        {/* Lista */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-border">
          <div className="border-b border-border p-3">
            <Select value={status} onValueChange={(v) => { setStatus(v); setSelected(null); }}>
              <SelectTrigger aria-label="Filtrar por estado">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="handoff">En handoff</SelectItem>
                <SelectItem value="open">Abiertas (bot)</SelectItem>
                <SelectItem value="closed">Cerradas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {conversations.isLoading ? (
              <div className="space-y-2 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (conversations.data ?? []).length === 0 ? (
              <p className="p-6 text-center text-[12px] text-faint-foreground">Sin conversaciones en este estado.</p>
            ) : (
              (conversations.data ?? []).map((conv) => (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => setSelected(conv.id)}
                  className={cn(
                    'flex w-full flex-col gap-0.5 border-b border-border px-3 py-2.5 text-left transition-colors hover:bg-surface-sunken/60',
                    selected === conv.id && 'bg-surface-sunken',
                  )}
                >
                  <span className="flex items-center justify-between">
                    <span className="font-mono text-[12.5px] font-medium">{conv.contact}</span>
                    <span className="text-[10px] text-faint-foreground">{timeAgo(conv.lastMessageAt)}</span>
                  </span>
                  <span className="text-[11px] text-faint-foreground">
                    {conv.channel} · {conv._count.messages} mensajes
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>

        {/* Detalle */}
        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <EmptyState icon={<Inbox />} title="Elegí una conversación" description="Vas a ver el historial completo del hilo." />
            </div>
          ) : (
            <>
              <header className="flex items-center justify-between border-b border-border px-5 py-3">
                <div>
                  <p className="font-mono text-[13px] font-semibold">{selectedConv?.contact}</p>
                  <p className="text-[11px] text-faint-foreground">
                    {selectedConv?.channel} · <Badge variant="warning" className="text-[10px]">{selectedConv?.status}</Badge>
                  </p>
                </div>
                <div className="flex gap-2">
                  {selectedConv?.status !== 'closed' ? (
                    <Button variant="secondary" size="sm" onClick={() => setConvStatus.mutate({ id: selected, next: 'closed' })}>
                      Cerrar
                    </Button>
                  ) : null}
                  {selectedConv?.status !== 'open' ? (
                    <Button variant="secondary" size="sm" onClick={() => setConvStatus.mutate({ id: selected, next: 'open' })}>
                      Devolver al bot
                    </Button>
                  ) : null}
                </div>
              </header>
              <div className="flex-1 space-y-2 overflow-y-auto p-5">
                {messages.isLoading ? (
                  <Skeleton className="h-40 w-full" />
                ) : (messages.data ?? []).length === 0 ? (
                  <p className="text-center text-[12px] text-faint-foreground">
                    <MessageSquare className="mx-auto mb-1 size-5 opacity-50" />
                    Sin mensajes.
                  </p>
                ) : (
                  (messages.data ?? []).map((m) => (
                    <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-start' : m.role === 'assistant' ? 'justify-end' : 'justify-center')}>
                      <div
                        className={cn(
                          'max-w-[75%] rounded-lg px-3 py-1.5 text-[12.5px] whitespace-pre-wrap',
                          m.role === 'user' && 'border border-border bg-surface-raised',
                          m.role === 'assistant' && 'bg-accent text-accent-foreground',
                          m.role === 'system' && 'bg-warning-soft text-[11px] text-warning',
                        )}
                      >
                        <span className="mb-0.5 block text-[9.5px] opacity-60">{ROLE_LABEL[m.role] ?? m.role}</span>
                        {m.text}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
