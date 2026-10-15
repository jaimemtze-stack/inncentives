import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from './logger';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { logger: createLogger('info', stream), lines };
}

describe('logger redaction', () => {
  it('redacts credentials, tokens, bodies and personal data', () => {
    const { logger, lines } = capture();
    logger.info({
      password: 'p',
      token: 't',
      email: 'ana@x.test',
      user: { email: 'b@x.test', passwordHash: 'h', phones: ['55'] },
      article: { bodyHtml: '<p>CURP</p>', bodyText: 'CURP' },
      req: { headers: { authorization: 'Bearer x', cookie: 'sid=1' } },
      route: '/api/v1/auth/login',
    });
    const out = lines.join('');
    for (const secret of [
      '"p"',
      '"t"',
      'ana@x.test',
      'b@x.test',
      '"h"',
      'CURP',
      'Bearer x',
      'sid=1',
      '"55"',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('/api/v1/auth/login');
    expect(out).toContain('[REDACTED]');
  });
});
