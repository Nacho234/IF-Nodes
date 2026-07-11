import { defineConfig, devices } from '@playwright/test';

/**
 * E2E del recorrido principal. Requiere el stack corriendo:
 *   npm run dev:api · npm run dev:worker · npm run dev:web (o los builds)
 *   + PostgreSQL y Redis, y el seed aplicado (npm run db:seed).
 * Base URL configurable con E2E_BASE_URL (default: el dev server en :3005).
 *
 * "setup" hace login una vez y guarda la sesión; el proyecto autenticado la
 * reutiliza (evita agotar el rate-limit del dev-login). "auth" prueba el login
 * en sí, sin sesión previa.
 */
const STORAGE_STATE = 'playwright/.auth/user.json';

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3005',
    trace: 'on-first-retry',
    headless: true,
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'auth',
      testMatch: /auth\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      testIgnore: [/auth\.spec\.ts/, /auth\.setup\.ts/],
      use: { ...devices['Desktop Chrome'], storageState: STORAGE_STATE },
      dependencies: ['setup'],
    },
  ],
});
