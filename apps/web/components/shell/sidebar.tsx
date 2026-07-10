'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  Blocks,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  FolderKanban,
  Home,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  LogOut,
  Moon,
  PackageOpen,
  Settings,
  Sun,
  Workflow,
} from 'lucide-react';
import { BRAND } from '@ifnodes/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Tooltip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Me } from '@/lib/types';

const NAV = [
  { href: '/', label: 'Inicio', icon: Home },
  { href: '/clients', label: 'Clientes', icon: Building2 },
  { href: '/projects', label: 'Proyectos', icon: FolderKanban },
  { href: '/templates', label: 'Plantillas', icon: LayoutTemplate },
  { href: '/executions', label: 'Ejecuciones', icon: ListChecks },
  { href: '/credentials', label: 'Credenciales', icon: KeyRound },
  { href: '/integrations', label: 'Integraciones', icon: Blocks },
  { href: '/exports', label: 'Exportaciones', icon: PackageOpen },
  { href: '/settings', label: 'Configuración', icon: Settings },
] as const;

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  DEVELOPER: 'Developer',
  TESTER: 'Tester',
  VIEWER: 'Viewer',
};

export function Sidebar({ me }: { me: Me }) {
  const pathname = usePathname();
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setCollapsed(localStorage.getItem('ifn:sidebar') === 'collapsed');
  }, []);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('ifn:sidebar', next ? 'collapsed' : 'open');
  };

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    router.push('/login');
    router.refresh();
  };

  return (
    <aside
      className={cn(
        'flex h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200',
        collapsed ? 'w-14' : 'w-56',
      )}
    >
      {/* Marca */}
      <div className={cn('flex h-14 items-center gap-2.5 border-b border-border px-3', collapsed && 'justify-center px-0')}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
          <Workflow className="size-4.5" strokeWidth={2} />
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-semibold tracking-tight">{BRAND.name}</p>
            <p className="truncate text-[10px] text-faint-foreground">builder interno</p>
          </div>
        )}
      </div>

      {/* Navegación */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Navegación principal">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
          const item = (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors',
                collapsed && 'justify-center px-0 py-2',
                active
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted-foreground hover:bg-surface-sunken hover:text-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" strokeWidth={1.75} />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
          return collapsed ? (
            <Tooltip key={href} content={label} side="right">
              {item}
            </Tooltip>
          ) : (
            item
          );
        })}
      </nav>

      {/* Pie: tema, colapsar, usuario */}
      <div className="space-y-1 border-t border-border p-2">
        <div className={cn('flex gap-1', collapsed ? 'flex-col items-center' : 'items-center')}>
          {mounted && (
            <Tooltip content={resolvedTheme === 'dark' ? 'Modo claro' : 'Modo oscuro'} side="right">
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
                aria-label="Cambiar tema"
                className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground"
              >
                {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </Tooltip>
          )}
          <Tooltip content={collapsed ? 'Expandir menú' : 'Colapsar menú'} side="right">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
              className="flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-sunken hover:text-foreground"
            >
              {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
            </button>
          </Tooltip>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-sunken',
                collapsed && 'justify-center px-0',
              )}
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold text-foreground uppercase">
                {me.name.slice(0, 2)}
              </span>
              {!collapsed && (
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-foreground">{me.name}</span>
                  <span className="block truncate text-[11px] text-faint-foreground">
                    {ROLE_LABELS[me.role] ?? me.role}
                  </span>
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-52">
            <DropdownMenuLabel>{me.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={logout} className="text-danger data-[highlighted]:bg-danger-soft">
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
