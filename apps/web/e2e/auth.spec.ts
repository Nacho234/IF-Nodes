import { expect, test } from '@playwright/test';

const AUTHORIZED_EMAIL = process.env.E2E_EMAIL ?? 'nachocapo573@hotmail.com';

test('login con email autorizado lleva al inicio', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email autorizado').fill(AUTHORIZED_EMAIL);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByText('Estado general del taller')).toBeVisible();
});

test('rechaza un email no autorizado', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email autorizado').fill('intruso@ajeno.com');
  await page.getByRole('button', { name: 'Ingresar' }).click();
  // El announcer de Next también es role=alert; se filtra al <p> del formulario
  await expect(page.locator('p[role="alert"]')).toContainText('no está autorizado');
});
