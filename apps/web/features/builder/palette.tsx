'use client';

import { useMemo, useState, type DragEvent } from 'react';
import { Search } from 'lucide-react';
import { NODE_CATEGORY_LABELS } from '@ifnodes/node-definitions';
import { Input } from '@/components/ui/input';
import { useBuilderStore } from './store';
import { categoryColor, nodeIcon } from './node-visuals';
import type { NodeTypeInfo } from '@/lib/types';

export const DND_MIME = 'application/x-ifnodes-type';

/**
 * Biblioteca de nodos (panel izquierdo): buscar, arrastrar al lienzo
 * o agregar con doble clic.
 */
export function NodePalette() {
  const nodeTypes = useBuilderStore((state) => state.nodeTypes);
  const addNode = useBuilderStore((state) => state.addNode);
  const [query, setQuery] = useState('');

  const grouped = useMemo(() => {
    const list = [...nodeTypes.values()].filter((info) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        info.displayName.toLowerCase().includes(q) ||
        info.description.toLowerCase().includes(q) ||
        info.type.toLowerCase().includes(q)
      );
    });
    const byCategory = new Map<string, NodeTypeInfo[]>();
    for (const info of list) {
      const bucket = byCategory.get(info.category) ?? [];
      bucket.push(info);
      byCategory.set(info.category, bucket);
    }
    return byCategory;
  }, [nodeTypes, query]);

  const onDragStart = (event: DragEvent, type: string) => {
    event.dataTransfer.setData(DND_MIME, type);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface" aria-label="Biblioteca de nodos">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-faint-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar nodos…"
            className="h-8 pl-8 text-[13px]"
            aria-label="Buscar nodos"
          />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {grouped.size === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-faint-foreground">
            Ningún nodo coincide con “{query}”.
          </p>
        ) : (
          [...grouped.entries()].map(([category, items]) => (
            <section key={category}>
              <h3 className="mb-1.5 px-1 text-[10px] font-semibold tracking-widest text-faint-foreground uppercase">
                {NODE_CATEGORY_LABELS[category as keyof typeof NODE_CATEGORY_LABELS] ?? category}
              </h3>
              <ul className="space-y-1">
                {items.map((info) => {
                  const Icon = nodeIcon(info.icon);
                  const color = categoryColor(info.category);
                  return (
                    <li key={info.type}>
                      <button
                        type="button"
                        draggable
                        onDragStart={(event) => onDragStart(event, info.type)}
                        onDoubleClick={() => addNode(info.type, { x: 120 + Math.random() * 80, y: 120 + Math.random() * 80 })}
                        title={`${info.description} (arrastrá al lienzo o doble clic)`}
                        className="flex w-full cursor-grab items-start gap-2.5 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-surface-sunken active:cursor-grabbing"
                      >
                        <span
                          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded"
                          style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
                        >
                          <Icon className="size-3.5" strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-foreground">
                            {info.displayName}
                          </span>
                          <span className="block truncate text-[10.5px] text-faint-foreground">
                            {info.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

      <p className="border-t border-border px-3 py-2 text-[10px] leading-4 text-faint-foreground">
        Set inicial de nodos (Fase 2). Webhook, condición, IA y WhatsApp llegan en Fases 3–7.
      </p>
    </aside>
  );
}
