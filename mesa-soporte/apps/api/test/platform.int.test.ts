import { PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS_KEY, PUBLIC_KEY } from '../src/policy/decorators';
import { AGENT, Client, PORTAL, startApp, type TestApp } from './helpers';

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => t.close());

describe('platform', () => {
  it('every route declares @Public or @RequirePermissions (deny by default)', () => {
    const missing: string[] = [];
    let checked = 0;
    for (const mod of t.app.get(ModulesContainer).values()) {
      for (const wrapper of mod.controllers.values()) {
        const ctrl = wrapper.metatype as new (...args: unknown[]) => unknown;
        if (!ctrl?.prototype) continue;
        for (const name of Object.getOwnPropertyNames(ctrl.prototype)) {
          if (name === 'constructor') continue;
          const handler = ctrl.prototype[name as keyof typeof ctrl.prototype] as unknown;
          if (
            typeof handler !== 'function' ||
            Reflect.getMetadata(PATH_METADATA, handler) === undefined
          )
            continue;
          checked++;
          const has = (key: string) =>
            Reflect.getMetadata(key, handler) !== undefined ||
            Reflect.getMetadata(key, ctrl) !== undefined;
          if (!has(PUBLIC_KEY) && !has(PERMISSIONS_KEY)) missing.push(`${ctrl.name}.${name}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });

  it('serves health checks on any host and rejects unknown hosts elsewhere', async () => {
    expect((await new Client(t.app, 'api:3000').get('/health')).statusCode).toBe(200);
    expect((await new Client(t.app, 'api:3000').get('/ready')).statusCode).toBe(200);
    const res = await new Client(t.app, 'evil.example').get('/api/v1/auth/me');
    expect(res.statusCode).toBe(421);
    expect(res.json().error.code).toBe('wrong_host');
  });

  it('tells the web app which area a host serves', async () => {
    expect((await new Client(t.app, PORTAL).get('/api/v1/auth/area')).json()).toEqual({
      area: 'portal',
    });
    expect((await new Client(t.app, AGENT).get('/api/v1/auth/area')).json()).toEqual({
      area: 'agent',
    });
  });

  it('sends security headers and no-store on API responses', async () => {
    const res = await new Client(t.app, PORTAL).get('/api/v1/auth/me');
    expect(res.statusCode).toBe(401);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toContain('max-age=63072000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects state-changing requests from other origins', async () => {
    const c = new Client(t.app, PORTAL);
    const cross = await c.post(
      '/api/v1/auth/login',
      { email: 'a@b.mx', password: 'x' },
      { origin: 'https://evil.example' },
    );
    expect(cross.statusCode).toBe(403);
    expect(cross.json().error.code).toBe('csrf_failed');
    const none = await c.post(
      '/api/v1/auth/login',
      { email: 'a@b.mx', password: 'x' },
      { origin: null },
    );
    expect(none.statusCode).toBe(403);
    const otherArea = await c.post(
      '/api/v1/auth/login',
      { email: 'a@b.mx', password: 'x' },
      { origin: `https://${AGENT}` },
    );
    expect(otherArea.statusCode).toBe(403);
    const crossSite = await c.post(
      '/api/v1/auth/login',
      { email: 'a@b.mx', password: 'x' },
      { headers: { 'sec-fetch-site': 'cross-site' } },
    );
    expect(crossSite.statusCode).toBe(403);
  });

  it('validates input and never echoes submitted values', async () => {
    const res = await new Client(t.app, PORTAL).post('/api/v1/auth/login', {
      email: 'not-an-email',
      password: 'secreto',
      extra: 1,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_failed');
    expect(JSON.stringify(res.json())).not.toContain('secreto');
  });

  it('uses CF-Connecting-IP only when enabled', async () => {
    // Disabled by default: the forwarded-for address is used.
    const c = new Client(t.app, PORTAL);
    await c.post(
      '/api/v1/auth/login',
      { email: 'cf@example.test', password: 'x' },
      { headers: { 'cf-connecting-ip': '203.0.113.99' } },
    );
    const row = await t.prisma.auditLog.findFirst({
      where: { action: 'auth.login.failed' },
      orderBy: { id: 'desc' },
    });
    expect(row?.ip).toBe(c.ip);
  });
});
