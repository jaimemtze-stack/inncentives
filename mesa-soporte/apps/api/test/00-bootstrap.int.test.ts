import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapFirstAdmin } from '../src/admin/bootstrap';
import { AGENT, Client, startApp, uniqueEmail, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t.close());

describe('first administrator bootstrap', () => {
  it('invites the first admin once, and the system placeholder can never sign in', async () => {
    // Runs first (files are sorted by name): the fresh test database has no admin yet.
    expect(await t.prisma.user.count({ where: { role: 'ADMIN' } })).toBe(0);
    const email = uniqueEmail('first-admin');
    const { token } = await bootstrapFirstAdmin(t.prisma, { email, name: 'Primera Admin' });
    const c = new Client(t.app, AGENT);
    expect(
      (
        await c.post('/api/v1/auth/invitations/accept', {
          token,
          name: 'Primera Admin',
          password: 'frase segura de la admin',
        })
      ).statusCode,
    ).toBe(204);
    expect((await c.login(email, 'frase segura de la admin')).json().state).toBe(
      'mfa_enrollment_required',
    );
    expect(
      (await new Client(t.app, AGENT).login('system@mesa.invalid', '!disabled')).statusCode,
    ).toBe(401);
    await expect(
      bootstrapFirstAdmin(t.prisma, { email: uniqueEmail('y'), name: 'Y' }),
    ).rejects.toThrow(/already exists/);
    const row = await t.prisma.auditLog.findFirst({
      where: { action: 'bootstrap.first_admin_invited' },
    });
    expect(row?.actorType).toBe('system');
  });
});
