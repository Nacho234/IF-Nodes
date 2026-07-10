import {
  CLIENT_STATUS_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_TYPE_LABELS,
  type ClientStatus,
  type ProjectStatus,
  type ProjectType,
} from '@ifnodes/shared';
import { Badge, type BadgeProps } from '@/components/ui/badge';

const CLIENT_VARIANTS: Record<ClientStatus, BadgeProps['variant']> = {
  PROSPECT: 'neutral',
  IN_DEVELOPMENT: 'accent',
  ACTIVE: 'success',
  PAUSED: 'warning',
  FINISHED: 'outline',
  ARCHIVED: 'neutral',
};

const PROJECT_VARIANTS: Record<ProjectStatus, BadgeProps['variant']> = {
  DRAFT: 'neutral',
  IN_DEVELOPMENT: 'accent',
  IN_TESTING: 'warning',
  READY_FOR_PRODUCTION: 'success',
  EXPORTED: 'success',
  IN_PRODUCTION: 'success',
  PAUSED: 'warning',
  ARCHIVED: 'neutral',
};

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return (
    <Badge dot variant={CLIENT_VARIANTS[status]}>
      {CLIENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge dot variant={PROJECT_VARIANTS[status]}>
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ProjectTypeLabel({ type }: { type: ProjectType }) {
  return <span className="text-[13px] text-muted-foreground">{PROJECT_TYPE_LABELS[type]}</span>;
}
