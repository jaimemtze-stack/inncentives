#!/usr/bin/env bash
# Writes /etc/pgbackrest/pgbackrest.conf from environment + secrets.
# Repository: OCI Object Storage through its S3-compatible API (MinIO in tests).
set -euo pipefail
SECRETS_DIR="${SECRETS_DIR:-/run/secrets}"
secret() { tr -d '\n' < "$SECRETS_DIR/$1"; }

: "${BACKUP_S3_ENDPOINT:?}" "${BACKUP_S3_BUCKET:?}" "${BACKUP_S3_REGION:?}"
conf=/etc/pgbackrest/pgbackrest.conf  # tmpfs in production (read-only root)
umask 077
cat > "$conf" <<CONF
[global]
repo1-type=s3
repo1-s3-endpoint=${BACKUP_S3_ENDPOINT}
repo1-s3-bucket=${BACKUP_S3_BUCKET}
repo1-s3-region=${BACKUP_S3_REGION}
repo1-s3-uri-style=path
repo1-s3-key=$(secret pgbackrest_s3_key)
repo1-s3-key-secret=$(secret pgbackrest_s3_key_secret)
repo1-path=${BACKUP_REPO_PATH:-/pgbackrest}
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$(secret pgbackrest_cipher_pass)
repo1-retention-full-type=time
repo1-retention-full=${BACKUP_RETENTION_DAYS:-35}
repo1-bundle=y
repo1-block=y
compress-type=zst
process-max=2
start-fast=y
archive-async=y
spool-path=/var/spool/pgbackrest
log-level-console=info
log-level-file=detail
log-path=/var/log/pgbackrest

[${BACKUP_STANZA:-mesa}]
pg1-path=${PGDATA}
pg1-socket-path=/var/run/postgresql
CONF
if [[ -n "${BACKUP_S3_CA_FILE:-}" ]]; then
  echo "repo1-s3-ca-file=${BACKUP_S3_CA_FILE}" >> "$conf"
fi
chmod 0600 "$conf"
