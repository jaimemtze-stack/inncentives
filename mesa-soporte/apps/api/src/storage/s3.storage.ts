import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  MAX_DOWNLOAD_URL_TTL,
  assertSafeKey,
  contentDisposition,
  type PutObjectInput,
  type StorageProvider,
} from './storage.provider';

export interface S3StorageOptions {
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** S3-compatible storage (MinIO in development and CI). */
export class S3Storage implements StorageProvider {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly opts: S3StorageOptions) {
    this.client = new S3Client({
      endpoint: opts.endpoint,
      region: opts.region,
      forcePathStyle: opts.forcePathStyle,
      credentials: opts.credentials,
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertSafeKey(input.key);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      }),
    );
  }

  async getObject(key: string): Promise<Readable> {
    assertSafeKey(key);
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.opts.bucket, Key: key }),
    );
    return res.Body as Readable;
  }

  async deleteObject(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.opts.bucket, Key: key }));
  }

  async createDownloadUrl(key: string, ttlSeconds: number, downloadName: string): Promise<string> {
    assertSafeKey(key);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        ResponseContentDisposition: contentDisposition(downloadName),
        ResponseContentType: 'application/octet-stream',
      }),
      { expiresIn: Math.min(ttlSeconds, MAX_DOWNLOAD_URL_TTL) },
    );
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.opts.bucket }));
  }
}
