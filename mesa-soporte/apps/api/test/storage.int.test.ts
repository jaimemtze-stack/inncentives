import { CreateBucketCommand, DeleteBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { S3Storage } from '../src/storage/s3.storage';

// Runs against any S3-compatible endpoint (SeaweedFS locally and in CI).
const endpoint = process.env.TEST_S3_ENDPOINT ?? 'http://127.0.0.1:8333';
const credentials = {
  accessKeyId: process.env.TEST_S3_KEY ?? 'devkey',
  secretAccessKey: process.env.TEST_S3_SECRET ?? 'devsecret123',
};
const bucket = `test-${randomBytes(4).toString('hex')}`;
const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
const storage = new S3Storage({
  endpoint,
  region: 'us-east-1',
  bucket,
  forcePathStyle: true,
  credentials,
});

beforeAll(async () => {
  // The store may still be starting (CI service, fresh container): retry.
  for (let attempt = 1; ; attempt++) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      return;
    } catch (err) {
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}, 60_000);

// Remove the throw-away bucket (its objects were deleted by the test).
afterAll(async () => {
  await client.send(new DeleteBucketCommand({ Bucket: bucket })).catch(() => undefined);
});

describe('S3Storage', () => {
  it('stores, reads, signs and deletes objects', async () => {
    const key = `attachments/${randomBytes(8).toString('hex')}`;
    await storage.putObject({
      key,
      body: Buffer.from('contenido de prueba'),
      contentType: 'text/plain',
    });
    await storage.ping();

    let text = '';
    for await (const chunk of await storage.getObject(key)) text += chunk;
    expect(text).toBe('contenido de prueba');

    const url = await storage.createDownloadUrl(key, 3600, 'reporte nómina.txt');
    const parsed = new URL(url);
    expect(Number(parsed.searchParams.get('X-Amz-Expires'))).toBe(300); // capped
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('contenido de prueba');

    // Tampering with the signature invalidates the link.
    parsed.searchParams.set('X-Amz-Signature', '0'.repeat(64));
    expect((await fetch(parsed)).status).toBe(403);

    await storage.deleteObject(key);
    await expect(storage.getObject(key)).rejects.toThrow();
  });

  it('rejects unsafe keys before calling the store', async () => {
    await expect(
      storage.putObject({ key: '../x', body: Buffer.from('x'), contentType: 'text/plain' }),
    ).rejects.toThrow('Invalid object key');
  });
});
