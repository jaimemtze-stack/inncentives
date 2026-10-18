import { expect, test } from '@playwright/test';

const PORTAL = 'http://soporte.localhost:5173';
const PASSWORD = 'frase de prueba e2e 2026';

test('a customer adds a passkey and then uses it as second factor', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  });

  const login = async () => {
    await page.goto(`${PORTAL}/entrar`);
    await page.getByLabel('Correo electrónico').fill('cliente@acme.example');
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  };
  await login();
  await expect(page.getByRole('heading', { name: /Bienvenido\(a\), Cliente Demo/ })).toBeVisible();

  await page.getByRole('link', { name: 'Mi cuenta' }).click();
  await page.getByLabel('Nombre (p. ej. "Laptop")').fill('Laptop de prueba');
  await page.getByRole('button', { name: 'Agregar llave' }).click();
  await expect(page.getByTestId('passkeys')).toContainText('Laptop de prueba');

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await login();
  await expect(page).toHaveURL(/\/verificar$/);
  await page.getByRole('button', { name: 'Usar una llave de seguridad o passkey' }).click();
  await expect(page.getByRole('heading', { name: /Bienvenido\(a\), Cliente Demo/ })).toBeVisible();
});
