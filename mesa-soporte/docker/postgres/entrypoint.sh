#!/usr/bin/env bash
# Initialises the cluster on first start (roles with least privilege, TLS,
# WAL archiving to pgBackRest) and then runs PostgreSQL as the postgres user.
set -euo pipefail

SECRETS_DIR="${SECRETS_DIR:-/run/secrets}"
read_secret() {
  local f="${INIT_SECRETS_DIR:-$SECRETS_DIR}/$1"
  [[ -s "$f" ]] || { echo "missing secret: $1" >&2; exit 1; }
  tr -d '\n' < "$f"
}

if [[ "$(id -u)" == "0" ]]; then
  chown -R postgres:postgres "$PGDATA" /var/log/pgbackrest /var/spool/pgbackrest /etc/pgbackrest
  chown postgres:postgres /var/run/postgresql
  chmod 0700 "$PGDATA"
  # Render pgBackRest configuration (needs root to read the secrets).
  if [[ "${BACKUP_ENABLED:-false}" == "true" ]]; then
    /usr/local/bin/pgbackrest-render
  fi
  # First start only: hand the init passwords to the postgres user through a
  # private temporary directory (removed right after initialisation).
  if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
    INIT_SECRETS_DIR="$(mktemp -d /tmp/pginit.XXXXXX)"
    for s in postgres_superuser_password postgres_migrator_password postgres_app_password; do
      install -o postgres -g postgres -m 0400 "$SECRETS_DIR/$s" "$INIT_SECRETS_DIR/$s"
    done
    chown postgres:postgres "$INIT_SECRETS_DIR"
    chmod 0700 "$INIT_SECRETS_DIR"
    export INIT_SECRETS_DIR
  fi
  exec setpriv --reuid=postgres --regid=postgres --init-groups "$0" "$@"
fi

if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
  echo "Initialising PostgreSQL cluster"
  pwfile="$(mktemp)"
  read_secret postgres_superuser_password > "$pwfile"
  initdb --username=postgres --pwfile="$pwfile" --auth-local=peer --auth-host=scram-sha-256 \
    --encoding=UTF8 --locale=C.UTF-8 --data-checksums >/dev/null
  rm -f "$pwfile"

  # Self-signed server certificate: traffic stays on the private Docker
  # network, TLS adds encryption in transit there too (ASVS 9.2.2).
  openssl_bin="$(command -v openssl || true)"
  if [[ -n "$openssl_bin" ]]; then
    "$openssl_bin" req -new -x509 -days 3650 -nodes -subj "/CN=postgres" \
      -keyout "$PGDATA/server.key" -out "$PGDATA/server.crt" >/dev/null 2>&1
    chmod 0600 "$PGDATA/server.key"
  fi

  cat >> "$PGDATA/postgresql.conf" <<CONF
listen_addresses = '*'
password_encryption = 'scram-sha-256'
max_connections = 60
shared_buffers = '${PG_SHARED_BUFFERS:-1GB}'
effective_cache_size = '${PG_EFFECTIVE_CACHE_SIZE:-3GB}'
work_mem = '16MB'
log_connections = on
log_disconnections = on
log_line_prefix = '%m [%p] %q%u@%d '
log_min_duration_statement = 1000
log_statement = 'ddl'
shared_preload_libraries = 'pg_stat_statements'
CONF
  if [[ -f "$PGDATA/server.crt" ]]; then
    printf "ssl = on\nssl_cert_file = 'server.crt'\nssl_key_file = 'server.key'\nssl_min_protocol_version = 'TLSv1.2'\n" >> "$PGDATA/postgresql.conf"
  fi
  if [[ "${BACKUP_ENABLED:-false}" == "true" ]]; then
    cat >> "$PGDATA/postgresql.conf" <<CONF
wal_level = replica
archive_mode = on
archive_command = 'pgbackrest --stanza=${BACKUP_STANZA:-mesa} archive-push %p'
archive_timeout = 60
max_wal_senders = 3
CONF
  fi

  # Only TLS connections with passwords from the private network; no trust.
  hosttype="host"; [[ -f "$PGDATA/server.crt" ]] && hosttype="hostssl"
  cat > "$PGDATA/pg_hba.conf" <<HBA
local   all  postgres                 peer
local   all  all                      scram-sha-256
$hosttype all  app_rw,app_migrator  0.0.0.0/0  scram-sha-256
$hosttype all  app_rw,app_migrator  ::/0       scram-sha-256
HBA

  pg_ctl -D "$PGDATA" -o "-c listen_addresses=''" -w start >/dev/null
  migrator_pw="$(read_secret postgres_migrator_password)"
  app_pw="$(read_secret postgres_app_password)"
  psql -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -v migrator_pw="$migrator_pw" -v app_pw="$app_pw" -v db="${POSTGRES_DB:-mesa}" >/dev/null <<'SQL'
CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_pw';
CREATE ROLE app_rw LOGIN PASSWORD :'app_pw' CONNECTION LIMIT 40;
CREATE DATABASE :"db" OWNER app_migrator;
\connect :"db"
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO app_migrator;
GRANT USAGE ON SCHEMA public TO app_rw;
-- Tables created later by migrations: the runtime role gets DML, never DDL.
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_rw;
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_rw;
SQL
  unset migrator_pw app_pw
  rm -rf "${INIT_SECRETS_DIR:?}"
  unset INIT_SECRETS_DIR
  pg_ctl -D "$PGDATA" -m fast -w stop >/dev/null
  echo "PostgreSQL initialised"
fi

exec postgres "$@"
