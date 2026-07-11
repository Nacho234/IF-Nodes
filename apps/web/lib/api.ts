/**
 * Cliente HTTP del navegador hacia la API (vía rewrite /api/*).
 * Incluye el header anti-CSRF exigido por el backend en mutaciones.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly issues?: { path: string; message: string }[];

  constructor(status: number, message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-ifn-csrf': '1',
      ...init.headers,
    },
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    // Sesión vencida: volver al login preservando el destino
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError(401, 'Sesión expirada');
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (body as { message?: string } | null)?.message ?? `Error ${response.status} en la API`;
    const issues = (body as { issues?: { path: string; message: string }[] } | null)?.issues;
    throw new ApiError(response.status, message, issues);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: data === undefined ? undefined : JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
