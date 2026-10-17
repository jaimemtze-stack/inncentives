import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';

const AGENT = 'http://agentes.soporte.localhost:5173';
const PORTAL = 'http://soporte.localhost:5173';
const PASSWORD = 'frase de prueba e2e 2026';

test('an administrator enrolls MFA, signs out and back in with a recovery code', async ({
  page,
}) => {
  await page.goto(`${AGENT}/`);
  await expect(page).toHaveURL(/\/entrar$/);
  await expect(page.getByText('Mesa de soporte — Agentes')).toBeVisible();

  await page.getByLabel('Correo electrónico').fill('admin@neitek.example');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();

  await expect(page).toHaveURL(/\/configurar-mfa$/);
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('Código de 6 dígitos').fill(authenticator.generate(secret));
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
  const codes = await page.getByTestId('recovery-codes').locator('li').allTextContents();
  expect(codes).toHaveLength(10);
  await page.getByRole('button', { name: 'Ya los guardé' }).click();
  await expect(page.getByRole('heading', { name: /Hola, Admin Demo/ })).toBeVisible();

  // The session cookie is HttpOnly and bound to this host.
  const cookies = await page.context().cookies(AGENT);
  const sid = cookies.find((c) => c.name === '__Host-sid');
  expect(sid?.httpOnly).toBe(true);
  expect(sid?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('__Host-sid');

  await page.getByRole('link', { name: 'Bitácora de auditoría' }).click();
  await page.getByRole('button', { name: 'Verificar integridad' }).click();
  await expect(page.getByText(/Integridad verificada/)).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/entrar$/);

  await page.getByLabel('Correo electrónico').fill('admin@neitek.example');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/verificar$/);
  await page.getByRole('button', { name: 'Usar un código de recuperación' }).click();
  await page.getByLabel('Código de recuperación').fill(codes[0]!);
  await page.getByRole('button', { name: 'Verificar' }).click();
  await expect(page.getByRole('heading', { name: /Hola, Admin Demo/ })).toBeVisible();

  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await expect(page.getByText('Esta sesión')).toBeVisible();
});

test('a customer signs in on the portal and cannot use the agents host', async ({ page }) => {
  await page.goto(`${AGENT}/entrar`);
  await page.getByLabel('Correo electrónico').fill('cliente@acme.example');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');

  await page.goto(`${PORTAL}/entrar`);
  await expect(page.getByText('Portal de clientes')).toBeVisible();
  await page.getByLabel('Correo electrónico').fill('cliente@acme.example');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: /Bienvenido\(a\), Cliente Demo/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Organizaciones' })).toHaveCount(0);

  await page.goto(`${PORTAL}/admin`);
  // The page exists in the bundle, but the API refuses admin calls on the portal host.
  await expect(page.getByRole('table')).not.toContainText('Neitek');
});

test('English is available', async ({ page }) => {
  await page.goto(`${PORTAL}/entrar`);
  await page.getByLabel('Idioma').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
