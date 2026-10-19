import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Client, PORTAL, makeOrg, makeUser, startApp, type TestApp } from './helpers';

let t: TestApp;
let editor: Client;
let agent: Client;
let customer: Client;
const CAT = '00000000-0000-4000-8000-000000000a07';

beforeAll(async () => {
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  const org = await makeOrg(t.prisma);
  const e = await makeUser(t.prisma, 'ADMIN', internal.id);
  const a = await makeUser(t.prisma, 'AGENT', internal.id);
  const c = await makeUser(t.prisma, 'CUSTOMER', org.id);
  editor = new Client(t.app, AGENT);
  agent = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  await editor.loginAndEnroll(e.email);
  await agent.loginAndEnroll(a.email);
  await customer.login(c.email);
});
afterAll(async () => t.close());

async function answer(
  title: string,
  visibility: 'customer' | 'internal',
  publish: boolean,
  publishAt?: string,
) {
  const a = (
    await editor.post('/api/v1/kb/answers', {
      categoryId: CAT,
      visibility,
      locale: 'es-MX',
      translation: {
        title,
        body: `<p>${title}: configura la fórmula del bono trimestral.</p><script>x()</script>`,
        keywords: ['bono'],
      },
    })
  ).json();
  if (publish)
    await editor.patch(`/api/v1/kb/answers/${a.id}`, {
      state: 'published',
      ...(publishAt ? { publishAt } : {}),
    });
  return a.id as string;
}

describe('knowledge base', () => {
  it('serves only published customer answers to customers, never drafts or internal ones', async () => {
    const pub = await answer('Cálculo de bonos', 'customer', true);
    const internal = await answer('Truco interno de bonos', 'internal', true);
    const draft = await answer('Borrador de bonos', 'customer', false);
    const later = await answer(
      'Bonos futuros',
      'customer',
      true,
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    const ids = async (c: Client) =>
      (await c.get('/api/v1/kb/search?q=bono')).json().map((x: { id: string }) => x.id);
    const forCustomer = await ids(customer);
    expect(forCustomer).toContain(pub);
    expect(forCustomer).not.toContain(internal);
    expect(forCustomer).not.toContain(draft);
    expect(forCustomer).not.toContain(later);
    const forAgent = await ids(agent);
    expect(forAgent).toEqual(expect.arrayContaining([pub, internal]));
    expect(forAgent).not.toContain(draft);
    expect(await ids(editor)).toEqual(expect.arrayContaining([pub, internal, draft, later]));

    expect((await customer.get(`/api/v1/kb/answers/${internal}`)).statusCode).toBe(404);
    const view = (await customer.get(`/api/v1/kb/answers/${pub}`)).json();
    expect(view.translations[0].bodyHtml).not.toContain('script');
    expect(view).not.toHaveProperty('visibility');
    // Accent-insensitive search.
    expect(await ids(customer)).toEqual(
      await (async () =>
        (await customer.get('/api/v1/kb/search?q=calculo'))
          .json()
          .map((x: { id: string }) => x.id))(),
    );
  });

  it('restricts editing to editors and keeps translation versions', async () => {
    expect(
      (
        await agent.post('/api/v1/kb/answers', {
          categoryId: CAT,
          locale: 'es-MX',
          translation: { title: 'x', body: 'y' },
        })
      ).statusCode,
    ).toBe(403);
    expect((await customer.get('/api/v1/kb/categories')).statusCode).toBe(200);
    const id = await answer('Versionado', 'customer', false);
    await editor.put(`/api/v1/kb/answers/${id}/translations/es-MX`, {
      title: 'Versionado v2',
      body: '<p>segunda</p>',
    });
    const en = await editor.put(`/api/v1/kb/answers/${id}/translations/en`, {
      title: 'Versioning',
      body: '<p>english</p>',
    });
    expect(
      en
        .json()
        .translations.map((x: { locale: string }) => x.locale)
        .sort(),
    ).toEqual(['en', 'es-MX']);
    const versions = (
      await editor.get(`/api/v1/kb/answers/${id}/translations/es-MX/versions`)
    ).json();
    expect(versions).toEqual([expect.objectContaining({ version: 1, title: 'Versionado' })]);
    await editor.patch(`/api/v1/kb/answers/${id}`, { state: 'published' });
    expect((await editor.delete(`/api/v1/kb/answers/${id}`)).statusCode).toBe(409);
    expect(
      await t.prisma.auditLog.findFirst({ where: { action: 'kb.answer.published', targetId: id } }),
    ).toBeTruthy();
    expect((await editor.delete(`/api/v1/kb/categories/${CAT}`)).statusCode).toBe(409);
  });
});
