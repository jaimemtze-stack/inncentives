import { describe, expect, it, vi } from 'vitest';
import { GraphAdapter, type OutboundMailAdapter } from './adapters';
import { renderMail } from './templates';
import { createTransactionalProcessor } from './transactional.processor';

describe('renderMail', () => {
  it('renders Spanish by default and English on request', () => {
    const es = renderMail('invitation', 'es-MX', {
      firstname: 'Ana',
      link: 'https://soporte.test/accept-invitation#token=x',
      hours: '72',
    });
    expect(es.subject).toBe('Invitación a Soporte Inncentives');
    expect(es.html).toContain('href="https://soporte.test/accept-invitation#token=x"');
    expect(es.text).toContain('72 horas');
    expect(renderMail('invitation', 'en', { link: 'https://x.test/a' }).subject).toBe(
      'Invitation to Inncentives Support',
    );
    expect(renderMail('password_changed', 'fr', {}).subject).toBe('Tu contraseña cambió');
  });

  it('escapes variables and rejects unsafe links', () => {
    const r = renderMail('new_device_login', 'es-MX', {
      userAgent: '<script>alert(1)</script>',
      date: 'x',
    });
    expect(r.html).not.toContain('<script>');
    expect(r.html).toContain('&lt;script&gt;');
    expect(() => renderMail('password_reset', 'es-MX', { link: 'javascript:alert(1)' })).toThrow();
    expect(() =>
      renderMail('password_reset', 'es-MX', { link: 'https://x.test/"onmouseover=1' }),
    ).toThrow();
    expect(renderMail('mfa_changed', 'en', { change: 'disabled' }).text).toContain('disabled');
  });
});

describe('transactional processor', () => {
  it('validates the job and sends through the adapter', async () => {
    const send = vi.fn().mockResolvedValue({ messageId: '1' });
    const adapter: OutboundMailAdapter = { send };
    const process = createTransactionalProcessor(
      adapter,
      'Soporte <s@x.test>',
      'Soporte Inncentives',
    );
    await process({ template: 'password_changed', to: 'a@x.test', locale: 'es-MX', vars: {} });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@x.test', from: 'Soporte <s@x.test>' }),
    );
    await expect(
      process({ template: 'unknown', to: 'a@x.test', locale: 'es', vars: {} }),
    ).rejects.toThrow();
    await expect(
      process({ template: 'password_changed', to: 'a@x.test\r\nBcc: z@y', locale: 'es', vars: {} }),
    ).rejects.toThrow();
  });
});

describe('GraphAdapter', () => {
  it('posts to the mailbox sendMail endpoint with a bearer token', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202, headers: { 'request-id': 'abc' } }));
    const a = new GraphAdapter(
      'soporte@x.test',
      async () => 'tkn',
      fetcher as unknown as typeof fetch,
    );
    const r = await a.send({
      from: 'x',
      to: 'a@x.test',
      subject: 'Hola',
      html: '<p>x</p>',
      text: 'x',
    });
    expect(r.messageId).toBe('abc');
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/soporte%40x.test/sendMail');
    expect(init.headers.authorization).toBe('Bearer tkn');
    await expect(
      a.send({ from: 'x', to: 'a@x.test', subject: 'a\nBcc: b', html: '', text: '' }),
    ).rejects.toThrow(/injection/);
    fetcher.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      a.send({ from: 'x', to: 'a@x.test', subject: 'x', html: '', text: '' }),
    ).rejects.toThrow(/403/);
  });
});
