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

  constructor(
    private readonly opts: OciStorageOptions,
    private readonly client: OciObjectClient,
  ) {}

  static async withInstancePrincipal(opts: OciStorageOptions): Promise<OciStorage> {
    const provider =
      await new common.InstancePrincipalsAuthenticationDetailsProviderBuilder().build();
    const client = new objectstorage.ObjectStorageClient({
      authenticationDetailsProvider: provider,
    });
    client.regionId = opts.region;
    return new OciStorage(opts, client);
  }

  private base() {
    return { namespaceName: this.opts.namespace, bucketName: this.opts.bucket };
  }

  async putObject(input: PutObjectInput): Promise<void> {
    assertSafeKey(input.key);
    await this.client.putObject({
      ...this.base(),
      objectName: input.key,
      putObjectBody: input.body,
      contentType: input.contentType,
      contentLength: input.contentLength,
    });
  }

  async getObject(key: string): Promise<Readable> {
    assertSafeKey(key);
    const res = await this.client.getObject({ ...this.base(), objectName: key });
    const body = res.value as unknown;
    if (body instanceof Readable) return body;
    return Readable.fromWeb(body as import('node:stream/web').ReadableStream);
  }

  async deleteObject(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.deleteObject({ ...this.base(), objectName: key });
  }

  /**
   * Object-scoped, read-only pre-authenticated request that expires in at most
   * five minutes. The PAR name records the purpose for later auditing.
   */
  async createDownloadUrl(key: string, ttlSeconds: number, _downloadName: string): Promise<string> {
    assertSafeKey(key);
    const ttl = Math.min(ttlSeconds, MAX_DOWNLOAD_URL_TTL);
    const res = await this.client.createPreauthenticatedRequest({
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
    await this.client.headBucket(this.base());
  }
}
