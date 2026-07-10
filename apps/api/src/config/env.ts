import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// El .env vive en la raíz del monorepo (src/ y dist/ están a la misma profundidad).
loadDotenv({ path: resolve(__dirname, '../../../../.env') });
loadDotenv(); // fallback: .env del directorio actual, sin pisar lo ya cargado

/**
 * Variables de entorno validadas al arrancar. Si falta algo crítico,
 * la API falla rápido con un mensaje claro en lugar de romperse después.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL es obligatoria'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET debe tener al menos 32 caracteres'),
  AUTHORIZED_EMAILS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  GOOGLE_CLIENT_ID: z.string().optional().default(''),
  GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  GOOGLE_REDIRECT_URI: z.string().optional().default('http://localhost:3001/auth/google/callback'),
  AUTH_DEV_LOGIN: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  REDIS_URL: z.string().optional().default(''),
});

export type Env = z.infer<typeof envSchema> & {
  isProduction: boolean;
  devLoginEnabled: boolean;
  googleConfigured: boolean;
};

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuración de entorno inválida:\n${detail}\nRevisá .env (ver .env.example).`);
  }
  const env = parsed.data;
  cached = {
    ...env,
    isProduction: env.NODE_ENV === 'production',
    // El dev-login se ignora por completo en producción (ver SECURITY.md)
    devLoginEnabled: env.AUTH_DEV_LOGIN && env.NODE_ENV !== 'production',
    googleConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
  };
  return cached;
}
