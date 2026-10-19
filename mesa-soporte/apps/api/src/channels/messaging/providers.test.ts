import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { parseTwilioSms, parseWhatsApp, verifyMetaSignature } from './providers';

const wa = (value: unknown) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{ field: 'messages', value }] }],
});

describe('WhatsApp Cloud API', () => {
  it('verifies the app signature over the raw body', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = 'sha256=' + createHmac('sha256', 's3cret').update(raw).digest('hex');
    expect(verifyMetaSignature('s3cret', raw, sig)).toBe(true);
    expect(verifyMetaSignature('other', raw, sig)).toBe(false);
    expect(verifyMetaSignature('s3cret', Buffer.from('{"a":2}'), sig)).toBe(false);
    expect(verifyMetaSignature('s3cret', raw, undefined)).toBe(false);
  });

  it('extracts messages, media and receipts and skips malformed parts', () => {
    const r = parseWhatsApp(
      wa({
        messaging_product: 'whatsapp',
        metadata: { display_phone_number: '525500000000', phone_number_id: '1234567890' },
        contacts: [{ profile: { name: 'Ana' }, wa_id: '5215511112222' }],
        messages: [
          { from: '5215511112222', id: 'wamid.A', type: 'text', text: { body: 'Hola' } },
          {
            from: '5215511112222',
            id: 'wamid.B',
            type: 'document',
            document: {
              id: 'MEDIA1',
              mime_type: 'application/pdf',
              filename: 'recibo.pdf',
              caption: 'Ver',
            },
          },
          { from: 'not-a-number', id: 'wamid.C', type: 'text', text: { body: 'x' } },
          { from: '5215511112222', id: 'wamid.D', type: 'location', location: {} },
        ],
        statuses: [
          {
            id: 'wamid.OUT',
            status: 'failed',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.OUT2', status: 'weird' },
        ],
      }),
    );
    expect(r.messages).toEqual([
      expect.objectContaining({
        from: '+5215511112222',
        name: 'Ana',
        externalId: 'wa:wamid.A',
        text: 'Hola',
      }),
      expect.objectContaining({
        externalId: 'wa:wamid.B',
        text: 'Ver',
        media: [{ id: 'MEDIA1', mimeType: 'application/pdf', filename: 'recibo.pdf' }],
      }),
      expect.objectContaining({ externalId: 'wa:wamid.D', text: '[location]' }),
    ]);
    expect(r.receipts).toEqual([
      { externalId: 'wa:wamid.OUT', status: 'failed', error: '131047 Re-engagement message' },
    ]);
    expect(parseWhatsApp({ object: 'page', entry: [] })).toEqual({ messages: [], receipts: [] });
    expect(parseWhatsApp(null)).toEqual({ messages: [], receipts: [] });
  });
});

describe('Twilio SMS', () => {
  const sid = 'SM' + 'b'.repeat(32);
  it('parses inbound messages and status callbacks', () => {
    expect(
      parseTwilioSms({
        MessageSid: sid,
        From: '+525511112222',
        To: '+525500000000',
        Body: 'Hola',
        SmsStatus: 'received',
      }),
    ).toEqual({
      message: expect.objectContaining({
        kind: 'sms',
        providerId: '+525500000000',
        externalId: `tw:${sid}`,
        text: 'Hola',
      }),
    });
    expect(
      parseTwilioSms({ MessageSid: sid, MessageStatus: 'undelivered', ErrorCode: '30003' }),
    ).toEqual({
      receipt: { externalId: `tw:${sid}`, status: 'failed', error: 'Twilio 30003' },
    });
    expect(parseTwilioSms({ MessageSid: 'x' })).toBeNull();
  });
});
