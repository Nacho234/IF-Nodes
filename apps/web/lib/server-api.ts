import { cookies } from 'next/headers';

const API_URL = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/**
 * Fetch desde Server Components hacia la API, reenviando la cookie de sesión.
 * Devuelve null ante 401 (el layout decide redirigir al login).
 */
export async function serverApiGet<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const response = await fetch(`${API_URL}${path}`, {
    headers: { cookie: cookieStore.toString() },
    cache: 'no-store',
  }).catch(() => null);

  if (!response || response.status === 401 || response.status === 403) return null;
  if (!response.ok) return null;
  return (await response.json()) as T;
}
