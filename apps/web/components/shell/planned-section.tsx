import { CalendarClock } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';

/**
 * Página para secciones que existen en la navegación pero se implementan
 * en fases posteriores. Estado honesto: dice qué va a haber y cuándo,
 * sin botones sin funcionalidad.
 */
export function PlannedSection({
  title,
  phase,
  description,
  bullets,
}: {
  title: string;
  phase: string;
  description: string;
  bullets: string[];
}) {
  return (
    <>
      <PageHeader title={title} description={description} />
      <div className="flex flex-1 items-start p-6">
        <div className="mx-auto mt-10 w-full max-w-md rounded-lg border border-dashed border-border-strong px-8 py-10 text-center">
          <CalendarClock className="mx-auto size-8 stroke-[1.5] text-faint-foreground" aria-hidden />
          <p className="mt-4 text-sm font-medium">Planificado para la {phase}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Esta sección todavía no está construida. Va a incluir:
          </p>
          <ul className="mx-auto mt-4 max-w-xs space-y-1.5 text-left text-[13px] text-muted-foreground">
            {bullets.map((bullet) => (
              <li key={bullet} className="flex gap-2">
                <span className="text-faint-foreground">·</span>
                {bullet}
              </li>
            ))}
          </ul>
          <p className="mt-5 font-mono text-[11px] text-faint-foreground">
            El orden de fases está en PROJECT_PLAN.md
          </p>
        </div>
      </div>
    </>
  );
}
