'use client';

import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import type { ComponentPropsWithoutRef, HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/* ── Skeleton ──────────────────────────────────────────────── */

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded-md bg-surface-sunken', className)} {...props} />;
}

/* ── Switch ────────────────────────────────────────────────── */

export function Switch({ className, ...props }: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface-sunken transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3.5 translate-x-0.5 rounded-full bg-muted-foreground shadow transition-transform data-[state=checked]:translate-x-4 data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
}

/* ── Tabs ──────────────────────────────────────────────────── */

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

export function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex items-center gap-0.5 border-b border-border', className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        '-mb-px cursor-pointer border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-accent data-[state=active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

/* ── Estados vacíos / de error ─────────────────────────────── */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-1 text-faint-foreground [&_svg]:size-8 [&_svg]:stroke-[1.5]">{icon}</div> : null}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-[13px] text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-danger/30 bg-danger-soft/40 px-6 py-10 text-center">
      <p className="text-sm text-danger">{message}</p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="cursor-pointer rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-sunken"
        >
          Reintentar
        </button>
      ) : null}
    </div>
  );
}
