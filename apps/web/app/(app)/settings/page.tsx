'use client';

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { USER_ROLES, type UserRole } from '@ifnodes/shared';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Me, TeamMember } from '@/lib/types';

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Owner',
  DEVELOPER: 'Developer',
  TESTER: 'Tester',
  VIEWER: 'Viewer',
};

const ROLE_DESC: Record<UserRole, string> = {
  OWNER: 'Acceso completo',
  DEVELOPER: 'Crea y modifica proyectos, flujos, credenciales y exportaciones',
  TESTER: 'Ejecuta flujos, usa el simulador y crea casos de prueba',
  VIEWER: 'Solo lectura',
};

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });
  const team = useQuery({ queryKey: ['team'], queryFn: () => api.get<TeamMember[]>('/users') });

  const isOwner = me.data?.role === 'OWNER';

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) =>
      api.patch(`/users/${id}/role`, { role }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['team'] }),
  });

  return (
    <>
      <PageHeader title="Configuración" description="Tu cuenta, el equipo y la seguridad del entorno." />

      <div className="flex-1 space-y-8 p-6">
        {/* Cuenta */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Tu cuenta</h2>
          {me.isLoading ? (
            <Skeleton className="h-20 w-full max-w-md" />
          ) : me.data ? (
            <div className="flex items-center gap-4 rounded-lg border border-border bg-surface px-5 py-4">
              <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent uppercase">
                {me.data.name.slice(0, 2)}
              </span>
              <div>
                <p className="text-sm font-medium">{me.data.name}</p>
                <p className="text-[13px] text-muted-foreground">{me.data.email}</p>
              </div>
              <Badge variant="accent" className="ml-auto">
                {ROLE_LABELS[me.data.role]}
              </Badge>
            </div>
          ) : null}
        </section>

        {/* Equipo */}
        <section>
          <h2 className="mb-1 text-sm font-semibold">Equipo</h2>
          <p className="mb-3 text-[13px] text-muted-foreground">
            El acceso se controla con la lista <code className="font-mono text-xs">AUTHORIZED_EMAILS</code> del
            entorno. Los usuarios aparecen acá al ingresar por primera vez.
          </p>
          {team.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : team.isError ? (
            <ErrorState message="No se pudo cargar el equipo." retry={() => void team.refetch()} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(team.data ?? []).map((member) => (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">{member.name}</TableCell>
                    <TableCell className="text-muted-foreground">{member.email}</TableCell>
                    <TableCell>
                      {isOwner && member.role !== 'OWNER' && member.id !== me.data?.id ? (
                        <Select
                          value={member.role}
                          onValueChange={(role) => changeRole.mutate({ id: member.id, role: role as UserRole })}
                        >
                          <SelectTrigger className="h-7.5 w-36 text-xs" aria-label={`Rol de ${member.name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {USER_ROLES.filter((r) => r !== 'OWNER').map((role) => (
                              <SelectItem key={role} value={role}>
                                {ROLE_LABELS[role]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant={member.role === 'OWNER' ? 'accent' : 'neutral'}>
                          {ROLE_LABELS[member.role]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-faint-foreground tabular-nums">
                      {formatDate(member.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Referencia de roles */}
          <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {USER_ROLES.map((role) => (
              <div key={role} className="rounded-md border border-border px-3 py-2">
                <dt className="text-[13px] font-medium">{ROLE_LABELS[role]}</dt>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">{ROLE_DESC[role]}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Seguridad */}
        <section>
          <h2 className="mb-3 text-sm font-semibold">Seguridad del entorno</h2>
          <div className="space-y-2 rounded-lg border border-border bg-surface px-5 py-4 text-[13px]">
            {[
              'Credenciales cifradas con AES-256-GCM; los secretos no vuelven al frontend',
              'Nodo HTTP con protección SSRF: bloquea IPs internas, privadas y metadata cloud',
              'Sesiones en base de datos con cookie HttpOnly + defensa CSRF por header',
              'Límites del motor: máx. 200 pasos y 60 s por ejecución',
              'Auditoría de acciones clave (login, credenciales, versiones, exportaciones)',
            ].map((item) => (
              <p key={item} className="flex items-start gap-2 text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
                {item}
              </p>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
