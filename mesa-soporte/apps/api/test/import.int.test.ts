import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Client, makeOrg, makeUser, startApp, uniqueEmail, type TestApp } from './helpers';

let t: TestApp;
let admin: Client;
let agent: Client;

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  admin = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  await admin.loginAndEnroll((await makeUser(t.prisma, 'ADMIN', internal.id)).email);
  await agent.loginAndEnroll((await makeUser(t.prisma, 'AGENT', internal.id)).email);
});
afterAll(async () => t.close());

describe('CSV import', () => {
  it('validates organizations first and writes nothing while there are errors', async () => {
    const bad = 'nombre;dominios;plan\nImport Uno;uno.mx;\nImport Dos;no_es_dominio;\n;x.mx;\nImport Tres;tres.mx;Inexistente\n';
    const r = (await admin.post('/api/v1/admin/import/organizations', { csv: bad, dryRun: false })).json();
    expect(r).toMatchObject({ total: 4, valid: 1, created: 0 });
    expect(r.errors.map((e: { row: number; field: string }) => `${e.row}:${e.field}`)).toEqual(['3:dominios', '4:nombre', '5:plan']);
    expect(await t.prisma.organization.count({ where: { name: 'Import Uno' } })).toBe(0);

    const good = 'nombre,dominios,mfa\nImport Uno,uno.mx|uno.com,sí\n"Import, Dos",dos.mx,no\n';
    expect((await admin.post('/api/v1/admin/import/organizations', { csv: good })).json()).toMatchObject({ dryRun: true, valid: 2, created: 0 });
    expect((await admin.post('/api/v1/admin/import/organizations', { csv: good, dryRun: false })).json()).toMatchObject({ created: 2 });
    expect(await t.prisma.organization.findFirst({ where: { name: 'Import Uno' } })).toMatchObject({ domains: ['uno.mx', 'uno.com'], mfaRequiredForCustomers: true });
    expect((await agent.post('/api/v1/admin/import/organizations', { csv: good })).statusCode).toBe(403);
  });

  it('imports users as invitations within the importer permissions', async () => {
    const e1 = uniqueEmail('imp');
    const e2 = uniqueEmail('imp');
    const csv = `correo,nombre,organizacion,rol\n${e1},Ana Import,Import Uno,\n${e2},Beto Import,Import Uno,ADMIN\n`;
    const r = (await agent.post('/api/v1/admin/import/users', { csv, dryRun: true })).json();
    expect(r.errors).toEqual([{ row: 3, field: 'rol', message: expect.stringContaining('not allowed') }]);
    const ok = (await agent.post('/api/v1/admin/import/users', { csv: `correo,nombre,organizacion\n${e1},Ana Import,Import Uno\n`, dryRun: false })).json();
    expect(ok).toMatchObject({ created: 1, errors: [] });
    expect(await t.prisma.invitation.findFirst({ where: { email: e1, role: 'CUSTOMER' } })).toBeTruthy();
    expect(await t.prisma.user.findUnique({ where: { email: e1 } })).toBeNull();
    expect(t.mails.some((m) => m.template === 'invitation' && m.to === e1)).toBe(true);
  });
});
