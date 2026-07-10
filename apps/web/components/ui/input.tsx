import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const baseFieldClasses =
  'w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground placeholder:text-faint-foreground transition-colors duration-150 hover:border-border-strong focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(baseFieldClasses, 'h-8.5', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(baseFieldClasses, 'min-h-20 py-2', className)} {...props} />
  ),
);
Textarea.displayName = 'Textarea';

export const CodeTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      spellCheck={false}
      className={cn(baseFieldClasses, 'min-h-28 py-2 font-mono text-xs leading-5', className)}
      {...props}
    />
  ),
);
CodeTextarea.displayName = 'CodeTextarea';
