import { describe, expect, it } from 'vitest';
import { TwilioTelephonyProvider, twilioSignature, verifyTwilio } from './twilio';

describe('Twilio', () => {
  it('computes the documented request signature', () => {
    // Test vector of Twilio's official helper library (twilio-node).
    const params = {
      CallSid: 'CA1234567890ABCDE',
      Caller: '+14158675309',
      Digits: '1234',
      From: '+14158675309',
      To: '+18005551212',
    };
    const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
    expect(twilioSignature('12345', url, params)).toBe('RSOYDt4T1cUTdK1PDd93/VVr8B8=');
    expect(verifyTwilio('12345', url, params, 'RSOYDt4T1cUTdK1PDd93/VVr8B8=')).toBe(true);
    expect(
      verifyTwilio('12345', url, { ...params, Digits: '9' }, 'RSOYDt4T1cUTdK1PDd93/VVr8B8='),
    ).toBe(false);
    expect(verifyTwilio('12345', url, params, undefined)).toBe(false);
  });

  it('maps call status callbacks to CTI events', () => {
    const base = {
      CallSid: 'CA' + 'a'.repeat(32),
      From: '+525512345678',
      To: '+525598765432',
      Direction: 'inbound',
    };
    expect(TwilioTelephonyProvider.parse({ ...base, CallStatus: 'ringing' })).toMatchObject({
      event: 'newCall',
      direction: 'in',
    });
    expect(
      TwilioTelephonyProvider.parse({ ...base, CallStatus: 'in-progress' }, 'a@n.mx'),
    ).toMatchObject({
      event: 'answer',
      user: 'a@n.mx',
    });
    expect(
      TwilioTelephonyProvider.parse({
        ...base,
        CallStatus: 'no-answer',
        Direction: 'outbound-dial',
      }),
    ).toMatchObject({ event: 'hangup', direction: 'out', cause: 'no-answer' });
    expect(() => TwilioTelephonyProvider.parse({ CallSid: 'x' })).toThrow();
    expect(() => TwilioTelephonyProvider.parse({ ...base, Nested: { a: 1 } })).toThrow();
  });
});
