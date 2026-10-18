import { createHmac, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const PORTAL = 'http://soporte.localhost:5173';
const PASSWORD = 'frase de prueba e2e 2026';

/** What the Inncentives backend does: an HS256 context token for the widget. */
function contextToken(): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({
    iss: 'inncentives',
    aud: 'mesa-soporte',
    iat: now,
    exp: now + 600,
    jti: randomUUID(),
    tenant: 'acme',
    environment: { id: 'acme-prod', name: 'Producción ACME', kind: 'production' },
    module: 'procesos',
    url: 'https://acme.inncentives.example/procesos/42',
    version: '2026.9.2',
  });
  const sig = createHmac('sha256', process.env.SECRET_INNCENTIVES_WIDGET_SECRET!)
    .update(`${head}.${body}`)
    .digest('base64url');
  return `${head}.${body}.${sig}`;
}

test('a customer reports a problem from Inncentives with the screen context', async ({ page }) => {
  await page.goto(`${PORTAL}/reportar#ctx=${contextToken()}`);
  // The token leaves the address bar immediately and survives the sign-in.
  await expect(page).toHaveURL(/\/entrar$/);
  await page.getByLabel('Correo electrónico').fill('cliente@acme.example');
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reportar un problema' })).toBeVisible();
  await expect(page.getByText('Producción ACME')).toBeVisible();
  await page.getByLabel('Título').fill('El proceso de cálculo terminó con error');
  await page.getByLabel('Mensaje').fill('Aparece un error al ejecutar el proceso trimestral.');
  await page.getByRole('button', { name: 'Enviar reporte' }).click();
  await expect(
    page.getByRole('heading', { name: 'El proceso de cálculo terminó con error' }),
  ).toBeVisible();
});
