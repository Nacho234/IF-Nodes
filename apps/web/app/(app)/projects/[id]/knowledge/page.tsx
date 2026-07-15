'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, Skeleton } from '@/components/ui/misc';
import type { ProjectDetail } from '@/lib/types';

interface KnowledgeChunk {
  id: string;
  title: string | null;
  content: string;
  tags: string[];
  createdAt: string;
}

export default function KnowledgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
  });
  const chunks = useQuery({
    queryKey: ['knowledge', projectId],
    queryFn: () => api.get<KnowledgeChunk[]>(`/projects/${projectId}/knowledge`),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['knowledge', projectId] });

  const create = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/knowledge`, {
        title: title.trim() || undefined,
        content,
        tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      }),
    onSuccess: () => {
      setTitle('');
      setContent('');
      setTags('');
      setError(null);
      refresh();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo agregar.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/knowledge/${id}`),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Proyectos', href: '/projects' },
          { label: project.data?.name ?? '…', href: `/projects/${projectId}` },
          { label: 'Conocimiento' },
        ]}
        title="Base de conocimiento"
        description="Fragmentos (FAQ, tono, políticas) que el agente recupera con el nodo Buscar conocimiento."
      />

      <div className="flex-1 space-y-4 p-6">
        {/* Alta */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-3 rounded-lg border border-border bg-surface-sunken/40 p-4"
        >
          <div className="flex flex-wrap gap-3">
            <div className="min-w-52 flex-1 space-y-1.5">
              <Label htmlFor="k-title">Título (opcional)</Label>
              <Input id="k-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Precios, Plazos, Tono…" />
            </div>
            <div className="min-w-52 flex-1 space-y-1.5">
              <Label htmlFor="k-tags">Etiquetas</Label>
              <Input id="k-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="faq, precios (coma)" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="k-content">Contenido</Label>
            <Textarea
              id="k-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Ej: La inscripción cuesta 5000 pesos por categoría. El cierre es el 30 de agosto."
              className="min-h-24"
              required
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="sm" loading={create.isPending} disabled={!content.trim()}>
              <Plus /> Agregar fragmento
            </Button>
            {error ? <p className="text-xs text-danger">{error}</p> : null}
          </div>
        </form>

        {/* Lista */}
        {chunks.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : (chunks.data ?? []).length === 0 ? (
          <EmptyState
            icon={<BookOpen />}
            title="Todavía no hay conocimiento"
            description="Cargá fragmentos con las preguntas frecuentes, el tono y las políticas del negocio. El agente los usa para responder fundamentado."
          />
        ) : (
          <div className="space-y-2">
            {(chunks.data ?? []).map((chunk) => (
              <div key={chunk.id} className="flex gap-3 rounded-lg border border-border bg-surface p-3">
                <div className="min-w-0 flex-1">
                  {chunk.title ? <p className="text-[13px] font-semibold">{chunk.title}</p> : null}
                  <p className="mt-0.5 text-[12.5px] whitespace-pre-wrap text-muted-foreground">{chunk.content}</p>
                  {chunk.tags.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {chunk.tags.map((t) => (
                        <Badge key={t} variant="neutral" className="text-[10px]">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Eliminar fragmento"
                  onClick={() => remove.mutate(chunk.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
