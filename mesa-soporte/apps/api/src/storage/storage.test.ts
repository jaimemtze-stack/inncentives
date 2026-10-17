import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { assertSafeKey, contentDisposition } from './storage.provider';
import { OciStorage, type OciObjectClient } from './oci.storage';

describe('storage helpers', () => {
  it('only accepts app-generated keys', () => {
    expect(() => assertSafeKey('attachments/2026/10/0b6e1c2a')).not.toThrow();
    for (const bad of ['../etc/passwd', '/abs', 'a//b', 'Mayus', 'a b', '']) {
      expect(() => assertSafeKey(bad)).toThrow();
    }
  });

  it('builds a safe Content-Disposition header', () => {
    expect(contentDisposition('nómina "final".xlsx')).toBe(
      `attachment; filename="n_mina _final_.xlsx"; filename*=UTF-8''n%C3%B3mina%20%22final%22.xlsx`,
    );
  });
});

describe('OciStorage', () => {
  const client = {
    putObject: vi.fn(async () => ({})),
    getObject: vi.fn(async () => ({ value: Readable.from(['hola']) })),
    deleteObject: vi.fn(async () => ({})),
    headBucket: vi.fn(async () => ({})),
    createPreauthenticatedRequest: vi.fn(async () => ({
      preauthenticatedRequest: {
        accessUri: '/p/abc/n/ns/b/adjuntos/o/k1',
        fullPath: 'https://objectstorage.mx-queretaro-1.oraclecloud.com/p/abc/n/ns/b/adjuntos/o/k1',
      },
    })),
  } as unknown as OciObjectClient;
  const storage = new OciStorage(
    { region: 'mx-queretaro-1', namespace: 'ns', bucket: 'adjuntos' },
    client,
  );

  it('creates object-scoped read-only PARs capped at five minutes', async () => {
    const before = Date.now();
    const url = await storage.createDownloadUrl('k1', 3600, 'x.pdf');
    expect(url).toContain('/p/abc/');
    const call = (client.createPreauthenticatedRequest as ReturnType<typeof vi.fn>).mock
      .calls[0]![0];
    const details = call.createPreauthenticatedRequestDetails;
    expect(details.accessType).toBe('ObjectRead');
    expect(details.objectName).toBe('k1');
    expect(details.timeExpires.getTime() - before).toBeLessThanOrEqual(300_000 + 1000);
  });

  it('passes namespace and bucket on every call', async () => {
    await storage.putObject({ key: 'k1', body: Buffer.from('x'), contentType: 'text/plain' });
    expect(client.putObject).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: 'ns', bucketName: 'adjuntos', objectName: 'k1' }),
    );
    const stream = await storage.getObject('k1');
    let text = '';
    for await (const chunk of stream) text += chunk;
    expect(text).toBe('hola');
  });
});
