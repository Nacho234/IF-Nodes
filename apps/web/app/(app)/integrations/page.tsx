'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Blocks, Plug } from 'lucide-react';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/shell/page-header';
import { Badge } from '@/components/ui/badge';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import type { CredentialTypeDef, CredentialView } from '@/lib/types';

export default function IntegrationsPage() {
  const types = useQuery({
    queryKey: ['credential-types'],
    queryFn: () => api.get<CredentialTypeDef[]>('/credentials/types'),
    staleTime: Infinity,
  });
  const credentials = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get<CredentialView[]>('/credentials'),
  });

  const countBySlug = (credentials.data ?? []).reduce<Record<string, number>>((acc, cred) => {
    acc[cred.integrationSlug] = (acc[cred.integrationSlug] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Integraciones"
        description="Servicios que los nodos pueden usar. Para conectarlos, creá una credencial."
        actions={
          <Link
            href="/credentials"
            className="inline-flex h-8.5 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3.5 text-sm font-medium hover:bg-surface-sunken"
          >
            <Plug className="size-4" /> Ver credenciales
          </Link>
        }
      />

      <div className="flex-1 p-6">
        {types.isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : types.isError ? (
          <ErrorState message="No se pudo cargar el catálogo." retry={() => void types.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(types.data ?? []).map((type) => {
              const count = countBySlug[type.slug] ?? 0;
              return (
                <Link
                  key={type.slug}
                  href="/credentials"
                  className="group flex flex-col rounded-lg border border-border bg-surface p-4 transition-colors hover:border-border-strong hover:bg-surface-sunken/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex size-9 items-center justify-center rounded-md bg-accent-soft text-accent">
                      <Blocks className="size-4.5" strokeWidth={1.75} />
                    </span>
                    {count > 0 ? (
                      <Badge variant="success" dot>
                        {count} conectada{count > 1 ? 's' : ''}
                      </Badge>
                    ) : type.verifiable ? (
                      <Badge variant="neutral">verificable</Badge>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm font-medium">{type.name}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{type.description}</p>
                  <span className="mt-3 flex items-center gap-1 text-[11px] text-accent opacity-0 transition-opacity group-hover:opacity-100">
                    {count > 0 ? 'Gestionar credenciales' : 'Conectar'} <ArrowRight className="size-3" />
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <p className="mt-6 text-[11px] text-faint-foreground">
          El envío real por WhatsApp Cloud y SMTP se suma como nodos de acción en una próxima iteración; hoy están
          disponibles como credenciales y el trigger de WhatsApp se prueba desde el Simulador.
        </p>
      </div>
    </>
  );
}
