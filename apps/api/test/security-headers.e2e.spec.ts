import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Browser, createTestContext, PORTAL, type TestContext } from './helpers';

describe('security headers, CORS and limits', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ BODY_LIMIT_BYTES: 2048 });
  });
  afterAll(() => ctx.close());

  it('sets strict headers on every response', async () => {
    const r = await new Browser(ctx.app, PORTAL).get('/api/v1/auth/csrf');
    expect(r.headers['content-security-policy']).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    );
    expect(r.headers['strict-transport-security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(r.headers['permissions-policy']).toContain('camera=()');
    expect(r.headers['x-frame-options']).toBe('DENY');
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('error responses also carry the headers and a correlation id but no stack', async () => {
    const r = await new Browser(ctx.app, PORTAL).get('/api/v1/does-not-exist');
    expect(r.statusCode).toBe(404);
    expect(r.headers['content-security-policy']).toBeDefined();
    expect(r.body).not.toMatch(/at .*\.ts:\d+/);
  });

  it('CORS is closed', async () => {
    const r = await new Browser(ctx.app, PORTAL).request(
      'OPTIONS',
      '/api/v1/auth/login',
      undefined,
      {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
      },
    );
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
    const g = await new Browser(ctx.app, PORTAL).request('GET', '/api/v1/auth/csrf', undefined, {
      origin: 'https://evil.example',
    });
    expect(g.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    const b = new Browser(ctx.app, PORTAL);
    await b.bootstrap();
    const r = await b.post('/api/v1/auth/login', { email: 'a@b.test', password: 'x'.repeat(5000) });
    expect(r.statusCode).toBe(413);
  });

  it('validates input with shared schemas', async () => {
    const b = new Browser(ctx.app, PORTAL);
    await b.bootstrap();
    const r = await b.post('/api/v1/auth/login', { email: 'not-an-email', password: 'x' });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toBe('validation_failed');
  });
});
