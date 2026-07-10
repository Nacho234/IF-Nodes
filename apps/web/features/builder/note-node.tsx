'use client';

import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { StickyNote } from 'lucide-react';
import { useBuilderStore, type NoteNode as NoteNodeType } from './store';

/** Nota adhesiva del lienzo (se persiste en graph.stickyNotes). */
function NoteNodeComponent({ id, data, selected }: NodeProps<NoteNodeType>) {
  const updateNoteText = useBuilderStore((state) => state.updateNoteText);

  return (
    <div
      className={`w-60 rounded-md border bg-warning-soft shadow-sm transition-shadow ${
        selected ? 'border-warning shadow-md' : 'border-warning/40'
      }`}
    >
      <div className="flex items-center gap-1.5 border-b border-warning/20 px-2.5 py-1.5 text-warning">
        <StickyNote className="size-3" />
        <span className="text-[10px] font-semibold tracking-wide uppercase">Nota</span>
      </div>
      <textarea
        value={data.text}
        onChange={(event) => updateNoteText(id, event.target.value)}
        placeholder="Escribí una nota para el equipo…"
        aria-label="Texto de la nota"
        className="nodrag block h-24 w-full resize-none bg-transparent px-2.5 py-2 text-[12px] leading-4.5 text-foreground placeholder:text-warning/50 focus:outline-none"
      />
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);
