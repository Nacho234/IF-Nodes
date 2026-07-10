'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import { BRAND } from '@ifnodes/shared';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/misc';
import type { AuthMethods } from '@/lib/types';

const OAUTH_ERRORS: Record<string, string> = {
  oauth_state: 'La sesión de Google expiró o fue inválida. Probá de nuevo.',
  unauthorized: 'Ese email no está autorizado para usar la aplicación.',
};

function LoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthError = searchParams.get('error');

  const methods = useQuery({
    queryKey: ['auth-methods'],
    queryFn: () => api.get<AuthMethods>('/auth/methods'),
    retry: 2,
  });

  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(oauthError ? (OAUTH_ERRORS[oauthError] ?? null) : null);

  const devLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/auth/dev-login', { email });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No se pudo iniciar sesión.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-accent text-accent-foreground shadow-lg">
            <Workflow className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{BRAND.name}</h1>
            <p className="mt-1 text-[13px] text-muted-foreground">{BRAND.tagline}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-surface p-6 shadow-sm">
          {methods.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : methods.isError ? (
            <p className="text-center text-[13px] text-danger">
              No se pudo contactar a la API. Verificá que esté corriendo (npm run dev:api).
            </p>
          ) : (
            <div className="space-y-4">
              {methods.data?.google ? (
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  onClick={() => {
                    window.location.href = '/api/auth/google';
                  }}
                >
                  <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
                    <path
                      fill="currentColor"
                      d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81"
                    />
                  </svg>
                  Continuar con Google
                </Button>
              ) : (
                <p className="rounded-md border border-border bg-surface-sunken px-3 py-2 text-xs text-muted-foreground">
                  Google OAuth todavía no está configurado (falta <code className="font-mono">GOOGLE_CLIENT_ID</code> en
                  el <code className="font-mono">.env</code> de la API).
                </p>
              )}

              {methods.data?.devLogin ? (
                <form onSubmit={devLogin} className="space-y-3 border-t border-border pt-4">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-warning uppercase">
                      Modo desarrollo
                    </span>
                    <span className="text-[11px] text-faint-foreground">deshabilitado en producción</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="dev-email">Email autorizado</Label>
                    <Input
                      id="dev-email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="vos@tuequipo.com"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </div>
                  <Button type="submit" variant="primary" className="w-full" loading={submitting}>
                    Ingresar
                  </Button>
                </form>
              ) : null}

              {error ? (
                <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
                  {error}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[11px] text-faint-foreground">
          Herramienta interna · acceso solo para emails autorizados
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}
