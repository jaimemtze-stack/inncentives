import { describe, expect, it } from 'vitest';
import { HttpInncentivesClient } from './inncentives.http';

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

describe('HttpInncentivesClient', () => {
  it('calls the documented paths with the token and validates the answers', async () => {
    const urls: string[] = [];
    let auth = '';
    const fake = (async (url: string, init: RequestInit) => {
      urls.push(url);
      auth = (init.headers as Record<string, string>).authorization!;
      if (url.endsWith('/environments'))
        return reply(200, {
          items: [
            { id: 'e1', name: 'Prod', kind: 'production', version: '1.0', url: 'https://x.mx' },
          ],
        });
      if (url.includes('process-runs'))
        return reply(200, {
          items: [
            {
              id: 'r1',
              environmentId: 'e1',
              process: 'Cálculo',
              module: 'calculo',
              status: 'failed',
              startedAt: '2026-10-01T10:00:00Z',
              finishedAt: null,
              message: 'x',
            },
          ],
        });
      return reply(404, {});
    }) as unknown as typeof fetch;
    const c = new HttpInncentivesClient('https://api.inncentives.example/', 'tok', fake);
    expect(await c.environments('acme')).toHaveLength(1);
    expect((await c.failedRuns('e1', 500))[0]!.startedAt).toBeInstanceOf(Date);
    expect(await c.recentEvents('e 1', 5)).toEqual([]);
    expect(urls).toEqual([
      'https://api.inncentives.example/v1/tenants/acme/environments',
      'https://api.inncentives.example/v1/environments/e1/process-runs?status=failed&limit=50',
      'https://api.inncentives.example/v1/environments/e%201/log-events?limit=5',
    ]);
    expect(auth).toBe('Bearer tok');
    expect(await c.environments('../etc')).toEqual([]);
  });

  it('rejects plain HTTP, errors and malformed data', async () => {
    expect(() => new HttpInncentivesClient('http://api.example', 't')).toThrow(/HTTPS/);
    const bad = (async () => reply(200, { items: [{ id: 'e1' }] })) as unknown as typeof fetch;
    await expect(
      new HttpInncentivesClient('https://a.example', 't', bad).environments('acme'),
    ).rejects.toThrow();
    const down = (async () => reply(503, '')) as unknown as typeof fetch;
    await expect(
      new HttpInncentivesClient('https://a.example', 't', down).environments('acme'),
    ).rejects.toThrow(/503/);
  });
});
