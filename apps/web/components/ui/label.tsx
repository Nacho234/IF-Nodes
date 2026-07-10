'use client';

import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef } from 'react';

export function Label({ className, ...props }: ComponentPropsWithoutRef<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      className={cn('text-xs font-medium text-muted-foreground select-none', className)}
      {...props}
    />
  );
}
