import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, setCsrfToken, takeFragmentToken } from './api';

afterEach(() => {
  vi.unstubAllGlobals();
  setCsrfToken(null);
});

describe('api client', () => {
  it('sends the CSRF token on writes only and stores new tokens', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ state: 'authenticated', csrfToken: 'tok1' }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await api('POST', '/auth/login', { email: 'a@b.mx', password: 'x' });
    await api('POST', '/auth/logout');
    await api('GET', '/auth/me');
    const headers = (fetchMock.mock.calls as unknown as [string, RequestInit][]).map(
      (c) => c[1].headers as Record<string, string>,
    );
    expect(headers[0]!['X-CSRF-Token']).toBeUndefined();
    expect(headers[1]!['X-CSRF-Token']).toBe('tok1');
    expect(headers[2]!['X-CSRF-Token']).toBeUndefined();
  });

  it('raises typed errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'x' } }), {
            status: 429,
            headers: { 'Retry-After': '30' },
          }),
      ),
    );
    await expect(api('POST', '/auth/login', {})).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfter: 30,
    });
    await expect(api('POST', '/auth/login', {})).rejects.toBeInstanceOf(ApiError);
  });

  it('reads the token from the fragment and removes it from the URL', () => {
    const token = 'a'.repeat(43);
    window.history.replaceState(null, '', `/invitacion#token=${token}`);
    expect(takeFragmentToken()).toBe(token);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invitacion');
  });
});
