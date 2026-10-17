import { Readable } from 'node:stream';
import * as common from 'oci-common';
import * as objectstorage from 'oci-objectstorage';
import {
  MAX_DOWNLOAD_URL_TTL,
  assertSafeKey,
  type PutObjectInput,
  type StorageProvider,
} from './storage.provider';

export interface OciStorageOptions {
  region: string;
  namespace: string;
  bucket: string;
}

/** The subset of the OCI SDK client this adapter uses (mockable in tests). */
export type OciObjectClient = Pick<
  objectstorage.ObjectStorageClient,
  'putObject' | 'getObject' | 'deleteObject' | 'createPreauthenticatedRequest' | 'headBucket'
>;

/**
 * OCI Object Storage through the native API with instance principals: the VM
 * identity (dynamic group + IAM policy) authorises the calls, so there is no
 * long-lived key in the application.
 */
export class OciStorage implements StorageProvider {
  readonly driver = 'oci' as const;
  private clientPromise?: Promise<OciObjectClient>;

  constructor(
    private readonly opts: OciStorageOptions,
    private readonly clientFactory: () => Promise<OciObjectClient>,
  ) {}

  /**
   * The instance-principal client is created on first use, so a slow or
   * temporarily unavailable metadata service never prevents the API from
   * starting; a failed attempt is retried on the next call.
   */
  static withInstancePrincipal(opts: OciStorageOptions): OciStorage {
    return new OciStorage(opts, async () => {
      const provider =
        await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
      const client = new objectstorage.ObjectStorageClient({
        authenticationDetailsProvider: provider,
      });
      client.regionId = opts.region;
      return client;
    });
  }

  private client(): Promise<OciObjectClient> {
    this.clientPromise ??= this.clientFactory().catch((err: unknown) => {
      this.clientPromise = undefined;
      throw err;
    });
    return this.clientPromise;
  }

  private base() {
    return { namespaceName: this.opts.namespace, bucketName: this.opts.bucket };
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertSafeKey(input.key);
    await (
      await this.client()
    ).putObject({
      ...this.base(),
      objectName: input.key,
      putObjectBody: input.body,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  async getObject(key: string): Promise<Readable> {
    assertSafeKey(key);
    const res = await (await this.client()).getObject({ ...this.base(), objectName: key });
    const body = res.value as unknown;
    if (body instanceof Readable) return body;
    return Readable.fromWeb(body as import('node:stream/web').ReadableStream);
  }

  async deleteObject(key: string): Promise<void> {
    assertSafeKey(key);
    await (await this.client()).deleteObject({ ...this.base(), objectName: key });
  }

  /**
   * Object-scoped, read-only pre-authenticated request that expires in at most
   * five minutes. The PAR name records the purpose for later auditing.
   */
  async createDownloadUrl(key: string, ttlSeconds: number, _downloadName: string): Promise<string> {
    assertSafeKey(key);
    const ttl = Math.min(ttlSeconds, MAX_DOWNLOAD_URL_TTL);
    const res = await (
      await this.client()
    ).createPreauthenticatedRequest({
      ...this.base(),
      createPreauthenticatedRequestDetails: {
        name: `dl-${Date.now()}`,
        objectName: key,
        accessType: objectstorage.models.CreatePreauthenticatedRequestDetails.AccessType.ObjectRead,
        timeExpires: new Date(Date.now() + ttl * 1000),
      },
    });
    return (
      res.preauthenticatedRequest.fullPath ??
      `https://objectstorage.${this.opts.region}.oraclecloud.com${res.preauthenticatedRequest.accessUri}`
    );
  }

  async ping(): Promise<void> {
    await (await this.client()).headBucket(this.base());
  }
}
