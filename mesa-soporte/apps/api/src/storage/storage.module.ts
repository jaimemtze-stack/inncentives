import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { OciStorage } from './oci.storage';
import { S3Storage } from './s3.storage';
import { STORAGE, StorageProvider } from './storage.provider';

export function createStorage(config: AppConfig): StorageProvider {
  if (config.STORAGE_DRIVER === 'oci') {
    if (!config.OCI_NAMESPACE) throw new Error('OCI_NAMESPACE is required with STORAGE_DRIVER=oci');
    return OciStorage.withInstancePrincipal({
      region: config.OCI_REGION,
      namespace: config.OCI_NAMESPACE,
      bucket: config.OCI_BUCKET_ATTACHMENTS,
    });
  }
  return new S3Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET_ATTACHMENTS,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: config.s3Credentials,
  });
}

@Global()
@Module({
  providers: [{ provide: STORAGE, inject: [APP_CONFIG], useFactory: createStorage }],
  exports: [STORAGE],
})
export class StorageModule {}
