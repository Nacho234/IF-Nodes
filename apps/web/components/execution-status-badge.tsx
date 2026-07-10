import type { ExecutionStatus } from '@ifnodes/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';

const VARIANTS: Record<ExecutionStatus, BadgeProps['variant']> = {
  QUEUED: 'neutral',
  RUNNING: 'accent',
  WAITING: 'warning',
  SUCCEEDED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  TIMED_OUT: 'danger',
};

const LABELS: Record<ExecutionStatus, string> = {
  QUEUED: 'En cola',
  RUNNING: 'Ejecutando',
  WAITING: 'Esperando',
  SUCCEEDED: 'Exitosa',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
  TIMED_OUT: 'Timeout',
};

export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
  return (
    <Badge dot variant={VARIANTS[status]}>
      {LABELS[status]}
    </Badge>
  );
}
