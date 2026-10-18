import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { twilioSignature } from '../src/channels/twilio/twilio';
import { Client, PORTAL, makeOrg, makeUser, startApp, type TestApp } from './helpers';

const TOKEN = 'twilio-test-auth-token';
let t: TestApp;
let hook: Client;
let agentEmail: string;

const form = (p: Record<string, string>) => new URLSearchParams(p).toString();
/** Posts a form the way Twilio does, signed for the public URL. */
const twilio = (path: string, params: Record<string, string>, sign = true) =>
  hook.request('POST', path, form(params), {
    origin: null,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(sign
        ? { 'x-twilio-signature': twilioSignature(TOKEN, `https://${PORTAL}${path}`, params) }
        : {}),
    },
  });

beforeAll(async () => {
  process.env.SECRET_TWILIO_AUTH_TOKEN = TOKEN;
  t = await startApp();
  const internal = await makeOrg(t.prisma, { internal: true });
  agentEmail = (await makeUser(t.prisma, 'AGENT', internal.id)).email;
  hook = new Client(t.app, PORTAL);
});
afterAll(async () => t.close());

describe('Twilio Voice connector', () => {
  const sid = 'CA' + '1'.repeat(32);
  const base = { CallSid: sid, From: '+525511112222', To: '+525533334444', Direction: 'inbound' };

  it('records the call from signed status callbacks only', async () => {
    expect(
      (await twilio('/hooks/twilio/voice', { ...base, CallStatus: 'ringing' }, false)).statusCode,
    ).toBe(401);
    const forged = await hook.request(
      'POST',
      '/hooks/twilio/voice',
      form({ ...base, CallStatus: 'ringing' }),
      {
        origin: null,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'x-twilio-signature': twilioSignature(
            'wrong',
            `https://${PORTAL}/hooks/twilio/voice`,
            base,
          ),
        },
      },
    );
    expect(forged.statusCode).toBe(401);

    expect(
      (await twilio('/hooks/twilio/voice', { ...base, CallStatus: 'ringing' })).statusCode,
    ).toBe(204);
    const path = `/hooks/twilio/voice?agent=${encodeURIComponent(agentEmail)}`;
    expect((await twilio(path, { ...base, CallStatus: 'in-progress' })).statusCode).toBe(204);
    expect((await twilio(path, { ...base, CallStatus: 'completed' })).statusCode).toBe(204);
    const log = await t.prisma.callLog.findUniqueOrThrow({ where: { callId: sid } });
    expect(log).toMatchObject({
      direction: 'in',
      state: 'ended',
      cause: 'completed',
      fromNumber: '+525511112222',
    });
    expect(log.userId).toBeTruthy();
    expect(log.answeredAt).toBeTruthy();
  });
});
