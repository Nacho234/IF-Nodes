import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';

export interface Crumb {
  label: string;
  href?: string;
}

/** Encabezado de página con breadcrumbs y acciones a la derecha. */
export function PageHeader({
  crumbs,
  title,
  description,
  actions,
}: {
  crumbs?: Crumb[];
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-surface px-6 py-4">
      {crumbs && crumbs.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-1 flex items-center gap-1 text-xs text-faint-foreground">
          {crumbs.map((crumb, index) => (
            <Fragment key={`${crumb.label}-${index}`}>
              {index > 0 && <ChevronRight className="size-3" aria-hidden />}
              {crumb.href ? (
                <Link href={crumb.href} className="transition-colors hover:text-foreground">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </Fragment>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
