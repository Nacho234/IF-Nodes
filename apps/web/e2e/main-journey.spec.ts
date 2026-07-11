import { expect, test } from '@playwright/test';

/**
 * Recorrido principal autenticado (usa la sesión guardada por auth.setup.ts).
 * Cubre criterios de aceptación 1–5 del MVP y el acceso a las secciones clave.
 */

test('el inicio muestra el estado del taller', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await expect(page.getByText('Estado general del taller')).toBeVisible();
});

test('crea un cliente y aparece en la tabla', async ({ page }) => {
  await page.goto('/clients');
  const nombre = `Cliente E2E ${Date.now()}`;
  await page.getByRole('button', { name: 'Nuevo cliente' }).first().click();
  await page.getByLabel('Nombre', { exact: false }).first().fill(nombre);
  await page.getByRole('button', { name: 'Crear cliente' }).click();
  await expect(page.getByText(nombre)).toBeVisible();
});

test('navega al bot demo y abre el constructor', async ({ page }) => {
  await page.goto('/projects');
  await page.getByRole('link', { name: 'Bot demo' }).first().click();
  await expect(page.getByRole('heading', { name: 'Bot demo' })).toBeVisible();

  await page.getByRole('link', { name: 'Abrir constructor' }).click();
  // La toolbar del constructor muestra las acciones principales (página pesada:
  // se le da tiempo extra a la primera compilación en dev)
  await expect(page.getByRole('button', { name: 'Ejecutar' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Exportar' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Versiones' })).toBeVisible();
});

test('credenciales y exportaciones cargan sin errores', async ({ page }) => {
  await page.goto('/credentials');
  await expect(page.getByRole('heading', { name: 'Credenciales' })).toBeVisible();
  await page.goto('/exports');
  await expect(page.getByRole('heading', { name: 'Exportaciones' })).toBeVisible();
});
