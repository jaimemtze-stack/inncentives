import { expect, test } from '@playwright/test';
import { authenticator } from 'otplib';

const AGENT = 'http://agentes.soporte.localhost:5173';
const PORTAL = 'http://soporte.localhost:5173';
const PASSWORD = 'frase de prueba e2e 2026';

test('an agent logs a call, the customer answers in the portal and the agent sees it live', async ({
  browser,
}) => {
  const agentCtx = await browser.newContext();
  const agent = await agentCtx.newPage();
  await agent.goto(`${AGENT}/entrar`);
  await agent.getByLabel('Correo electrónico').fill('agente@neitek.example');
  await agent.getByLabel('Contraseña').fill(PASSWORD);
  await agent.getByRole('button', { name: 'Entrar' }).click();
  const secret = (await agent.getByTestId('totp-secret').textContent())!.trim();
  await agent.getByLabel('Código de 6 dígitos').fill(authenticator.generate(secret));
  await agent.getByRole('button', { name: 'Activar' }).click();
  await agent.getByRole('button', { name: 'Ya los guardé' }).click();
  await expect(agent.getByRole('heading', { name: /Hola, Agente Demo/ })).toBeVisible();

  await agent.getByRole('link', { name: 'Nuevo ticket' }).click();
  await agent.getByLabel('Buscar cliente (nombre, correo o teléfono)').fill('Cliente');
  await agent.getByRole('button', { name: /Cliente Demo/ }).click();
  await agent.getByLabel('Título').fill('No se generan los recibos de bonos');
  await agent.getByLabel('Mensaje').fill('El cliente llamó para reportar el problema.');
  await agent.getByRole('button', { name: 'Crear ticket' }).click();
  await expect(
    agent.getByRole('heading', { name: 'No se generan los recibos de bonos' }),
  ).toBeVisible();
  await agent.getByLabel('Mensaje').fill('Nota interna: revisar el proceso calendarizado.');
  await agent.getByRole('button', { name: 'Enviar' }).click();
  await expect(agent.getByText('Nota interna: revisar el proceso calendarizado.')).toBeVisible();

  const customerCtx = await browser.newContext();
  const customer = await customerCtx.newPage();
  await customer.goto(`${PORTAL}/entrar`);
  await customer.getByLabel('Correo electrónico').fill('cliente@acme.example');
  await customer.getByLabel('Contraseña').fill(PASSWORD);
  await customer.getByRole('button', { name: 'Entrar' }).click();
  await customer.getByRole('link', { name: 'No se generan los recibos de bonos' }).click();
  await expect(customer.getByText('El cliente llamó para reportar el problema.')).toBeVisible();
  // Internal notes never reach the portal.
  await expect(customer.getByText('Nota interna: revisar')).toHaveCount(0);
  await customer.getByLabel('Mensaje').fill('Ya adjunto el detalle, gracias.');
  await customer.getByRole('button', { name: 'Enviar' }).click();
  await expect(customer.getByText('Ya adjunto el detalle, gracias.')).toBeVisible();

  // Realtime: the agent page refreshes without reloading.
  await expect(agent.getByText('Ya adjunto el detalle, gracias.')).toBeVisible({ timeout: 10_000 });
  await agentCtx.close();
  await customerCtx.close();
});
