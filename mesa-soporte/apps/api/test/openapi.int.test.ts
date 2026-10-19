import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Client, PORTAL, makeOrg, makeUser, startApp, type TestApp } from './helpers';

let t: TestApp;
let agent: Client;
let customer: Client;

beforeAll(async () => {
  t = await startApp();
  agent = new Client(t.app, AGENT);
  customer = new Client(t.app, PORTAL);
  await agent.loginAndEnroll(
    (await makeUser(t.prisma, 'AGENT', (await makeOrg(t.prisma, { internal: true })).id)).email,
  );
  await customer.login((await makeUser(t.prisma, 'CUSTOMER', (await makeOrg(t.prisma)).id)).email);
});
afterAll(async () => t.close());

describe('OpenAPI', () => {
  it('describes every route with its parameters, body and authorization', async () => {
    expect((await customer.get('/api/v1/openapi.json')).statusCode).toBe(403);
    const res = await agent.get('/api/v1/openapi.json');
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.1.0');
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBeGreaterThan(80);
    expect(paths).toContain('/api/v1/tickets/{id}');
    expect(paths).toContain('/hooks/azure-devops');
    expect(
      paths.every(
        (p) =>
          p.startsWith('/api/v1/') || p.startsWith('/hooks/') || ['/health', '/ready'].includes(p),
      ),
    ).toBe(true);

    const create = doc.paths['/api/v1/tickets'].post;
    expect(
      create.requestBody.content['application/json'].schema.oneOf[0].properties.title,
    ).toBeTruthy();
    expect(create.security).toEqual([{ session: [] }, { bearer: [] }]);
    expect(doc.paths['/api/v1/auth/login'].post.security).toEqual([]);
    const search = doc.paths['/api/v1/search/global'].get;
    expect(search.parameters).toContainEqual(
      expect.objectContaining({ name: 'q', in: 'query', required: true }),
    );
    expect(search['x-permissions'].any).toContain('tickets.customer');
    expect(doc.paths['/api/v1/tickets/{id}'].get.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
  });
});
