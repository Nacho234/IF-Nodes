'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Lock, Plus, Trash2 } from 'lucide-react';
import { ENVIRONMENT_KINDS } from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch, Tabs, TabsContent, TabsList, TabsTrigger, EmptyState, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { EnvironmentView, ProjectDetail } from '@/lib/types';

export default function VariablesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = use(params);
  const queryClient = useQueryClient();

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
  });
  const environments = useQuery({
    queryKey: ['environments', projectId],
    queryFn: () => api.get<EnvironmentView[]>(`/projects/${projectId}/environments`),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['environments', projectId] });

  return (
    <>
      <PageHeader
        crumbs={[
          { label: 'Proyectos', href: '/projects' },
          { label: project.data?.name ?? '…', href: `/projects/${projectId}` },
          { label: 'Variables' },
        ]}
        title="Variables por entorno"
        description="Valores por entorno para {{environment.X}}. Las secretas se guardan cifradas."
      />

      <div className="flex-1 p-6">
        {environments.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <Tabs defaultValue="DEVELOPMENT">
            <TabsList>
              {ENVIRONMENT_KINDS.map((kind) => (
                <TabsTrigger key={kind} value={kind}>
                  {kind}
                </TabsTrigger>
              ))}
            </TabsList>
            {ENVIRONMENT_KINDS.map((kind) => {
              const env = environments.data?.find((e) => e.kind === kind);
              return (
                <TabsContent key={kind} value={kind} className="mt-4">
                  <EnvironmentPanel
                    projectId={projectId}
                    kind={kind}
                    variables={env?.variables ?? []}
                    onChanged={refresh}
                  />
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </div>
    </>
  );
}

function EnvironmentPanel({
  projectId,
  kind,
  variables,
  onChanged,
}: {
  projectId: string;
  kind: string;
  variables: EnvironmentView['variables'];
  onChanged: () => void;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [secret, setSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/environments/${kind}/variables`, { key, value, secret }),
    onSuccess: () => {
      setKey('');
      setValue('');
      setSecret(false);
      setError(null);
      onChanged();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'No se pudo agregar.'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/environment-variables/${id}`),
    onSuccess: onChanged,
  });

  return (
    <div className="space-y-4">
      {variables.length === 0 ? (
        <EmptyState
          icon={<KeyRound />}
          title={`Sin variables en ${kind}`}
          description="Agregá variables que tus nodos usan con {{environment.NOMBRE}}."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Clave</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="w-10" aria-label="Acciones" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {variables.map((v) => (
              <TableRow key={v.id}>
                <TableCell className="font-mono text-[13px]">{v.key}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{v.value}</TableCell>
                <TableCell>
                  {v.secret ? (
                    <Badge variant="warning" className="gap-1">
                      <Lock className="size-3" /> secreta
                    </Badge>
                  ) : (
                    <Badge variant="neutral">plana</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Eliminar ${v.key}`}
                    onClick={() => remove.mutate(v.id)}
                  >
                    <Trash2 />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {/* Alta */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface-sunken/40 p-4"
      >
        <div className="space-y-1.5">
          <Label htmlFor={`k-${kind}`}>Clave</Label>
          <Input
            id={`k-${kind}`}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="CALENDAR_API_URL"
            className="w-52 font-mono text-xs"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`v-${kind}`}>Valor</Label>
          <Input
            id={`v-${kind}`}
            type={secret ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="w-64 font-mono text-xs"
          />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id={`s-${kind}`} checked={secret} onCheckedChange={setSecret} />
          <Label htmlFor={`s-${kind}`} className="cursor-pointer">
            Secreta
          </Label>
        </div>
        <Button type="submit" variant="primary" size="sm" loading={create.isPending}>
          <Plus /> Agregar
        </Button>
        {error ? <p className="w-full text-xs text-danger">{error}</p> : null}
      </form>
    </div>
  );
}
