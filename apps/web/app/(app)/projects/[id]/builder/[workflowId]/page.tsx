'use client';

import { use } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Builder } from '@/features/builder/builder';
import { ErrorState, Skeleton } from '@/components/ui/misc';
import type { NodeTypeInfo, WorkflowDetail } from '@/lib/types';

export default function BuilderPage({
  params,
}: {
  params: Promise<{ id: string; workflowId: string }>;
}) {
  const { workflowId } = use(params);

  const workflow = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => api.get<WorkflowDetail>(`/workflows/${workflowId}`),
  });
  const catalog = useQuery({
    queryKey: ['node-types'],
    queryFn: () => api.get<NodeTypeInfo[]>('/node-types'),
    staleTime: Infinity,
  });

  if (workflow.isLoading || catalog.isLoading) {
    return (
      <div className="flex h-full flex-col gap-px">
        <Skeleton className="h-12 rounded-none" />
        <div className="flex flex-1 gap-px">
          <Skeleton className="w-60 rounded-none" />
          <Skeleton className="flex-1 rounded-none" />
          <Skeleton className="w-80 rounded-none" />
        </div>
      </div>
    );
  }

  if (workflow.isError || catalog.isError || !workflow.data || !catalog.data) {
    return (
      <div className="p-6">
        <ErrorState
          message="No se pudo cargar el flujo. Verificá que la API esté corriendo."
          retry={() => {
            void workflow.refetch();
            void catalog.refetch();
          }}
        />
      </div>
    );
  }

  return <Builder workflow={workflow.data} catalog={catalog.data} />;
}
