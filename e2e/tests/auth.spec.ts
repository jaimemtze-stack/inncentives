import { expect, test } from '@playwright/test';
import { totp } from './totp';

const PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'demo frase segura 2026';
const AGENT_URL = process.env.E2E_AGENT_URL ?? 'http://agents.localhost:5173';

test('customer signs in on the portal, sees the home page and signs out', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('cliente@acme.test');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Carla' })).toBeVisible();
  await expect(
    page.getByText('Te recomendamos activar la verificación en dos pasos'),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sesiones activas' })).toBeVisible();

  // Session cookie is not readable from JavaScript
  const cookies = await page.evaluate(() => document.cookie);
  expect(cookies).not.toContain('_sid=');

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

test('wrong credentials show a generic message', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill('nadie@acme.test');
  await page.getByLabel('Contraseña').fill('contraseña incorrecta');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
});

test('the interface switches to English', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Idioma').selectOption('en');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('an agent must enroll MFA on first sign-in on the agent host', async ({ page }) => {
  await page.goto(`${AGENT_URL}/login`);
  await page.getByLabel('Correo electrónico').fill('agente2@demo.inncentives.test');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(
    page.getByRole('heading', { name: 'Configura la verificación en dos pasos' }),
  ).toBeVisible();
  const manual = await page.getByText(/Clave para captura manual/).textContent();
  const secret = manual!.split(':')[1]!.trim();
  await page.getByLabel('Código').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByRole('heading', { name: 'Códigos de recuperación' })).toBeVisible();
  await expect(page.locator('li.font-mono, ul.font-mono li')).toHaveCount(10);
  await page.getByRole('button', { name: 'Continuar' }).click();
  await expect(page.getByRole('heading', { name: 'Hola, Diana' })).toBeVisible();
});
