'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

/**
 * Confirmación para acciones destructivas. Muestra el error del servidor si la
 * acción falla (p.ej. "el cliente tiene proyectos") sin cerrar el diálogo.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Eliminar',
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  /** Debe lanzar (throw) si falla; el mensaje se muestra en el diálogo. */
  onConfirm: () => Promise<void>;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setLoading(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar la acción.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setError(null);
      }}
    >
      <DialogContent title={title} className="max-w-md">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
            <AlertTriangle className="size-4.5" />
          </span>
          <div className="text-[13px] text-muted-foreground">{description}</div>
        </div>
        {error ? (
          <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirm} loading={loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
