import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AGENT, Client, PASSWORD, makeOrg, makeUser, startApp, type TestApp } from './helpers';

let t: TestApp;
let idp: Server;
let issuer: string;
let agentEmail: string;
/** code -> claims the fake identity provider will put in the ID token. */
const codes = new Map<string, Record<string, unknown>>();

async function startIdp() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
      });
    }
    if (url.pathname === '/jwks') return json({ keys: [jwk] });
    if (url.pathname === '/token' && req.method === 'POST') {
      let raw = '';
      for await (const c of req) raw += c;
      const form = new URLSearchParams(raw);
      const claims = codes.get(form.get('code') ?? '');
      if (!claims || form.get('client_secret') !== 'idp-secret' || !form.get('code_verifier'))
        return json({ error: 'invalid_grant' }, 400);
      const { aud, ...rest } = claims;
      const idToken = await new SignJWT(rest)
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(issuer)
        .setAudience((aud as string) ?? 'mesa-agents')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      return json({ id_token: idToken, token_type: 'Bearer' });
    }
    json({ error: 'not_found' }, 404);
  });
  await new Promise<void>((r) => idp.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
}

/** Runs start → (fake consent) → callback and returns the callback response. */
async function flow(
  c: Client,
  mode: 'login' | 'link',
  claims: (nonce: string) => Record<string, unknown>,
) {
  const start = await c.post('/api/v1/auth/sso/entra/start', { mode });
  if (start.statusCode !== 200) return start;
  const url = new URL(start.json().url);
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  const code = Math.random().toString(36).slice(2);
  codes.set(code, claims(url.searchParams.get('nonce')!));
  return c.get(
    `/api/v1/auth/sso/entra/callback?code=${code}&state=${url.searchParams.get('state')}`,
  );
}

beforeAll(async () => {
  await startIdp();
  process.env.SECRET_TEST_IDP_SECRET = 'idp-secret';
  t = await startApp();
  await t.prisma.appSetting.upsert({
    where: { key: 'sso_providers' },
    create: {
      key: 'sso_providers',
      value: [
        {
          id: 'entra',
          label: 'Microsoft',
          area: 'agent',
          issuer,
          clientId: 'mesa-agents',
          secretName: 'test_idp_secret',
          scopes: 'openid email',
          trustIdpMfa: true,
        },
      ],
    },
    update: {},
  });
  const internal = await makeOrg(t.prisma, { internal: true });
  agentEmail = (await makeUser(t.prisma, 'AGENT', internal.id)).email;
});
afterAll(async () => {
  idp.close();
  await t.close();
});

describe('OIDC single sign-on', () => {
  it('never signs in an identity that was not linked first (not even with a matching e-mail)', async () => {
    const res = await flow(new Client(t.app, AGENT), 'login', (nonce) => ({
      sub: 'entra-123',
      email: agentEmail,
      nonce,
    }));
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/entrar?sso=error');
  });

  it('links an identity for a signed-in user and then signs in with it', async () => {
    const user = new Client(t.app, AGENT);
    await user.loginAndEnroll(agentEmail);
    expect((await user.get('/api/v1/auth/sso/providers')).json()).toEqual([
      { id: 'entra', label: 'Microsoft' },
    ]);
    // Link needs the session's CSRF token.
    expect(
      (await user.post('/api/v1/auth/sso/entra/start', { mode: 'link' }, { csrf: null }))
        .statusCode,
    ).toBe(403);
    await user.post('/api/v1/auth/reauth', { password: PASSWORD });
    const link = await flow(user, 'link', (nonce) => ({ sub: 'entra-123', nonce }));
    expect(link.headers.location).toBe('/cuenta?sso=linked');

    // Without MFA in "amr": our own second factor is still required.
    const a = new Client(t.app, AGENT);
    const noMfa = await flow(a, 'login', (nonce) => ({ sub: 'entra-123', nonce, amr: ['pwd'] }));
    expect(noMfa.headers.location).toBe('/verificar');
    expect((await a.get('/api/v1/auth/me')).json().state).toBe('mfa_required');

    // The IdP reports MFA and the provider is trusted for it.
    const b = new Client(t.app, AGENT);
    const ok = await flow(b, 'login', (nonce) => ({
      sub: 'entra-123',
      nonce,
      amr: ['pwd', 'mfa'],
    }));
    expect(ok.headers.location).toBe('/');
    expect((await b.get('/api/v1/auth/me')).json()).toMatchObject({
      state: 'authenticated',
      user: { email: agentEmail },
    });
    expect(await t.prisma.auditLog.findFirst({ where: { action: 'auth.sso.login' } })).toBeTruthy();
  });

  it('rejects bad nonce, wrong audience, replayed state and the wrong host', async () => {
    const c = new Client(t.app, AGENT);
    expect(
      (await flow(c, 'login', () => ({ sub: 'entra-123', nonce: 'other', amr: ['mfa'] }))).headers
        .location,
    ).toBe('/entrar?sso=error');
    expect(
      (await flow(c, 'login', (nonce) => ({ sub: 'entra-123', nonce, aud: 'someone-else' })))
        .headers.location,
    ).toBe('/entrar?sso=error');
    const start = await c.post('/api/v1/auth/sso/entra/start', { mode: 'login' });
    const state = new URL(start.json().url).searchParams.get('state');
    const code = 'replay';
    codes.set(code, {
      sub: 'entra-123',
      nonce: new URL(start.json().url).searchParams.get('nonce'),
      amr: ['mfa'],
    });
    expect(
      (await c.get(`/api/v1/auth/sso/entra/callback?code=${code}&state=${state}`)).headers.location,
    ).toBe('/');
    expect(
      (await c.get(`/api/v1/auth/sso/entra/callback?code=${code}&state=${state}`)).headers.location,
    ).toBe('/entrar?sso=error');
    expect(
      (
        await new Client(t.app, 'soporte.test').post('/api/v1/auth/sso/entra/start', {
          mode: 'login',
        })
      ).statusCode,
    ).toBe(404);
  });
});
