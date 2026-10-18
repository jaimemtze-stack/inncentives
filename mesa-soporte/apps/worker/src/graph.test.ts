import { describe, expect, it } from 'vitest';
import { GraphMailer } from './graph';

describe('GraphMailer', () => {
  it('gets a client-credentials token once and sends through sendMail', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.includes('/oauth2/v2.0/token'))
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), {
          status: 200,
        });
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;
    const m = new GraphMailer(
      { tenantId: 't-1', clientId: 'c-1', clientSecret: 's', sender: 'soporte@neitek.com' },
      fake,
    );
    await m.send({ to: 'a@b.mx', subject: 'Hola', text: 'x', html: '<p>x</p>' });
    await m.send({ to: 'c@d.mx', subject: 'Hola', text: 'y' });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      '/t-1/oauth2/v2.0/token',
      '/v1.0/users/soporte%40neitek.com/sendMail',
      '/v1.0/users/soporte%40neitek.com/sendMail',
    ]);
    expect(String(calls[0]!.init.body)).toContain('grant_type=client_credentials');
    const sent = JSON.parse(String(calls[2]!.init.body));
    expect(sent.message.body).toEqual({ contentType: 'Text', content: 'y' });
    expect(sent.message.toRecipients[0].emailAddress.address).toBe('c@d.mx');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('fails the job (to be retried) when Graph does not accept the message', async () => {
    const fake = (async (url: string) =>
      url.includes('token')
        ? new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 })
        : new Response('{}', { status: 403 })) as unknown as typeof fetch;
    const m = new GraphMailer(
      { tenantId: 't', clientId: 'c', clientSecret: 's', sender: 's@x.mx' },
      fake,
    );
    await expect(m.send({ to: 'a@b.mx', subject: 's', text: 't' })).rejects.toThrow(/HTTP 403/);
  });
});
