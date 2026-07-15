'use client';

import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from 'lucide-react';
import { api } from '@/lib/api';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';

interface ReadinessItem {
  level: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  action?: string;
}

const ICON = {
  error: <CircleAlert className="size-4 shrink-0 text-danger" />,
  warning: <AlertTriangle className="size-4 shrink-0 text-warning" />,
  info: <Info className="size-4 shrink-0 text-accent" />,
};

/**
 * Checklist de "Puesta en marcha": qué falta conectar/cargar/configurar para que
 * el flujo funcione de verdad, con la acción concreta de cada punto. Es
 * determinístico (backend), no depende del Copilot.
 */
export function ReadinessDialog({
  open,
  onOpenChange,
  workflowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflowId: string;
}) {
  const readiness = useQuery({
    queryKey: ['readiness', workflowId],
    queryFn: () => api.get<{ items: ReadinessItem[] }>(`/workflows/${workflowId}/readiness`),
    enabled: open,
  });

  const items = readiness.data?.items ?? [];
  const blocking = items.filter((i) => i.level !== 'info');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Puesta en marcha"
        description="Qué falta conectar o cargar para que este flujo funcione al 100%."
      >
        {readiness.isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : items.length === 0 ? (
          <div className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-3 text-[13px] text-success">
            <CheckCircle2 className="size-4" /> Todo listo: no falta conectar nada para que el flujo corra de verdad.
          </div>
        ) : (
          <div className="space-y-2">
            {blocking.length === 0 ? (
              <div className="flex items-center gap-2 rounded-md bg-success-soft px-3 py-2 text-[12.5px] text-success">
                <CheckCircle2 className="size-4" /> Nada bloqueante. Solo quedan notas de setup externo abajo.
              </div>
            ) : null}
            {items.map((item, index) => (
              <div key={index} className="flex gap-2.5 rounded-md border border-border bg-surface px-3 py-2.5">
                {ICON[item.level]}
                <div className="min-w-0">
                  <p className="text-[12.5px]">{item.message}</p>
                  {item.action ? (
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">→ {item.action}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
