'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { AlertTriangle, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBuilderStore, type BuilderNode } from './store';
import { categoryColor, nodeIcon } from './node-visuals';

/**
 * Nodo visual del constructor. Solo presenta metadatos de la definición;
 * la lógica de ejecución vive en packages/node-definitions (desacoplada).
 */
function FlowNodeComponent({ id, data, selected }: NodeProps<BuilderNode>) {
  const info = useBuilderStore((state) => state.nodeTypes.get(data.nodeType));
  const hasConfigIssue = useBuilderStore((state) =>
    state.configIssues.some((issue) => issue.nodeId === id),
  );

  const Icon = nodeIcon(info?.icon ?? '');
  const color = categoryColor(info?.category ?? '');
  const inputs = info?.inputs ?? [{ id: 'main', label: 'Entrada' }];
  const outputs = info?.outputs ?? [];

  return (
    <div
      className={cn(
        'w-56 rounded-lg border bg-[var(--node-bg)] shadow-sm transition-shadow duration-150',
        selected
          ? 'border-[var(--node-border-selected)] shadow-lg ring-1 ring-[var(--node-border-selected)]'
          : 'border-[var(--node-border)] hover:shadow-md',
        data.disabled && 'opacity-50',
      )}
      style={{ borderTopWidth: 3, borderTopColor: color }}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
        >
          <Icon className="size-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] leading-tight font-semibold text-foreground">{data.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-faint-foreground">
            {info?.displayName ?? data.nodeType}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {data.disabled ? (
            <span title="Nodo desactivado" className="text-faint-foreground">
              <EyeOff className="size-3.5" />
            </span>
          ) : null}
          {hasConfigIssue ? (
            <span title="Configuración incompleta" className="text-warning">
              <AlertTriangle className="size-3.5" />
            </span>
          ) : null}
        </div>
      </div>

      {/* Puertos de entrada */}
      {inputs.map((port, index) => (
        <Handle
          key={port.id}
          id={port.id}
          type="target"
          position={Position.Left}
          style={{ top: 24 + index * 18 }}
          aria-label={`Entrada ${port.label}`}
        />
      ))}

      {/* Puertos de salida (con etiqueta si hay más de uno) */}
      {outputs.map((port, index) => (
        <div key={port.id}>
          <Handle
            id={port.id}
            type="source"
            position={Position.Right}
            style={{ top: outputs.length === 1 ? '50%' : 24 + index * 20 }}
            aria-label={`Salida ${port.label}`}
          />
          {outputs.length > 1 ? (
            <span
              className="absolute right-2 text-[9px] font-medium text-faint-foreground uppercase"
              style={{ top: 18 + index * 20 }}
            >
              {port.label}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export const FlowNode = memo(FlowNodeComponent);
