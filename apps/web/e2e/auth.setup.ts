import { expect, test as setup } from '@playwright/test';

const AUTHORIZED_EMAIL = process.env.E2E_EMAIL ?? 'nachocapo573@hotmail.com';
const STORAGE_STATE = 'playwright/.auth/user.json';

/** Login una sola vez y guarda la sesión para los tests autenticados. */
setup('autenticar', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email autorizado').fill(AUTHORIZED_EMAIL);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Inicio' })).toBeVisible();
  await page.context().storageState({ path: STORAGE_STATE });
});
