'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, KeyRound, MoreHorizontal, Pencil, Plug, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CredentialDialog } from '@/features/credentials/credential-dialog';
import type { CredentialView } from '@/lib/types';

export default function CredentialsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CredentialView | undefined>(undefined);
  const [verifyResult, setVerifyResult] = useState<Record<string, { ok: boolean; message: string }>>({});

  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<CredentialView[]>('/credentials'),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['credentials'] });

  const verify = useMutation({
    mutationFn: (id: string) => api.post<{ ok: boolean; message: string }>(`/credentials/${id}/verify`),
    onSuccess: (result, id) => {
      setVerifyResult((current) => ({ ...current, [id]: result }));
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/credentials/${id}`),
    onSuccess: refresh,
  });

  const list = credentials.data ?? [];

  return (
    <>
      <PageHeader
        title="Credenciales"
        description="Conexiones cifradas a servicios externos (IA, WhatsApp, SMTP, HTTP)."
        actions={
          <Button
            variant="primary"
            onClick={() => {
              setEditing(undefined);
              setDialogOpen(true);
            }}
          >
            <Plus /> Nueva credencial
          </Button>
        }
      />

      <div className="flex-1 p-6">
        {credentials.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : credentials.isError ? (
          <ErrorState message="No se pudieron cargar las credenciales." retry={() => void credentials.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            title="Todavía no hay credenciales"
            description="Agregá una API key de IA, WhatsApp Cloud o SMTP. Los secretos se guardan cifrados."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setEditing(undefined);
                  setDialogOpen(true);
                }}
              >
                <Plus /> Nueva credencial
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Entorno</TableHead>
                <TableHead>Secreto</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-10" aria-label="Acciones" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((cred) => {
                const result = verifyResult[cred.id];
                return (
                  <TableRow key={cred.id}>
                    <TableCell className="font-medium">{cred.name}</TableCell>
                    <TableCell className="text-muted-foreground">{cred.integrationName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {cred.environment}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-faint-foreground">
                      {cred.maskedHint ?? '—'}
                    </TableCell>
                    <TableCell>
                      {result ? (
                        <span
                          className={`flex items-center gap-1 text-[11px] ${result.ok ? 'text-success' : 'text-danger'}`}
                        >
                          {result.ok ? <Check className="size-3" /> : null}
                          {result.message}
                        </span>
                      ) : cred.lastVerifiedAt ? (
                        <span className="flex items-center gap-1 text-[11px] text-success">
                          <Check className="size-3" /> verificada {timeAgo(cred.lastVerifiedAt)}
                        </span>
                      ) : (
                        <span className="text-[11px] text-faint-foreground">sin verificar</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Acciones para ${cred.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onSelect={() => verify.mutate(cred.id)}
                            disabled={verify.isPending}
                          >
                            <ShieldCheck /> Probar conexión
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(cred);
                              setDialogOpen(true);
                            }}
                          >
                            <Pencil /> Editar / rotar
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-danger data-[highlighted]:bg-danger-soft"
                            onSelect={() => remove.mutate(cred.id)}
                          >
                            <Trash2 /> Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-faint-foreground">
          <Plug className="size-3" />
          Los nodos de IA y HTTP usan estas credenciales por su nombre; el secreto nunca sale del backend.
        </p>
      </div>

      <CredentialDialog open={dialogOpen} onOpenChange={setDialogOpen} credential={editing} />
    </>
  );
}
