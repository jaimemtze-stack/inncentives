#!/usr/bin/env bash
# End-to-end backup test (CI and local): full backup + continuous WAL to an
# S3-compatible store, encrypted logical dump, then destroy and restore to a
# point in time with the production scripts. Requires docker, openssl, age
# and root (sudo -E), like restore.sh in production.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
scripts="$here/../scripts"

WORK="$(mktemp -d)"
export WORK
export COMPOSE_FILE="$here/compose.backup-test.yml"
export COMPOSE_ENV_FILE="$WORK/images.env"
export COMPOSE_PROJECT="mesa-backup-test-$$"
export PGDATA_HOST="$WORK/pgdata"
export APP_SERVICES=""
compose() { docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" --env-file "$COMPOSE_ENV_FILE" "$@"; }
psql_q() { compose exec -T -u postgres postgres psql -v ON_ERROR_STOP=1 -d mesa -Atc "$1"; }

cleanup() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then compose logs --no-color --tail 60 s3 postgres >&2 || true; fi
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  # Files written by containers belong to other uids.
  docker run --rm --user 0 --entrypoint rm -v "$WORK:/w" "${IMAGE_POSTGRES:-mesa-postgres:dev}" -rf /w/pgdata /w/pgdata.before-restore-* >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

echo "IMAGE_POSTGRES=${IMAGE_POSTGRES:-mesa-postgres:dev}" > "$COMPOSE_ENV_FILE"
mkdir -p "$WORK/secrets" "$WORK/certs/CAs" "$WORK/pgdata" "$WORK/dumps" "$WORK/s3conf"
for s in postgres_superuser_password postgres_migrator_password postgres_app_password pgbackrest_cipher_pass; do
  openssl rand -base64 24 > "$WORK/secrets/$s"
done
echo testkey > "$WORK/secrets/pgbackrest_s3_key"
echo testsecret123 > "$WORK/secrets/pgbackrest_s3_key_secret"
cat > "$WORK/s3conf/s3.json" <<'JSON'
{"identities":[{"name":"backup","credentials":[{"accessKey":"testkey","secretKey":"testsecret123"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
chown 5432:5432 "$WORK"/secrets/* "$WORK/pgdata"   # postgres uid in the image
chmod 0400 "$WORK"/secrets/*

# Private CA + certificate for the S3 store (pgBackRest only talks HTTPS to S3).
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=test-ca" \
  -keyout "$WORK/certs/ca.key" -out "$WORK/certs/CAs/ca.crt" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=s3.test" \
  -keyout "$WORK/certs/private.key" -out "$WORK/certs/s3.csr" 2>/dev/null
printf "subjectAltName=DNS:s3.test,DNS:localhost\n" > "$WORK/certs/ext.cnf"
openssl x509 -req -in "$WORK/certs/s3.csr" -CA "$WORK/certs/CAs/ca.crt" -CAkey "$WORK/certs/ca.key" \
  -CAcreateserial -days 1 -extfile "$WORK/certs/ext.cnf" -out "$WORK/certs/public.crt" 2>/dev/null
chmod 0644 "$WORK"/certs/*.crt "$WORK"/certs/CAs/ca.crt "$WORK/certs/private.key"

age-keygen -o "$WORK/age.key" 2>/dev/null
age-keygen -y "$WORK/age.key" > "$WORK/age.pub"

echo "== start the S3 store and PostgreSQL"
compose up -d --wait s3
weed_shell() { compose exec -T s3 weed shell -master=localhost:9333 2>/dev/null; }
for b in respaldos-pitr respaldos-inmutables; do
  for _ in $(seq 1 20); do
    echo "s3.bucket.create -name $b" | weed_shell >/dev/null || true
    echo "s3.bucket.list" | weed_shell | grep -qw "$b" && break
    sleep 1
  done
done
compose up -d --wait postgres

echo "== full backup"
"$scripts/backup.sh" full
"$scripts/backup.sh" check

psql_q "create table pagos (id serial primary key, nota text not null, creado timestamptz default now())"
psql_q "insert into pagos (nota) select 'antes-' || g from generate_series(1, 500) g"
sleep 2
target="$(psql_q "select to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")"
sleep 2
psql_q "insert into pagos (nota) select 'despues-' || g from generate_series(1, 200) g"
psql_q "select pg_switch_wal()" >/dev/null
# Wait until the WAL with the last insert reached the repository.
for _ in $(seq 1 30); do
  compose exec -T -u postgres postgres pgbackrest --stanza=mesa check >/dev/null 2>&1 && break
  sleep 2
done
[[ "$(psql_q 'select count(*) from pagos')" == "700" ]] || fail "unexpected row count before restore"

echo "== encrypted logical dump"
LOCAL_DUMP_DIR="$WORK/dumps" UPLOADER=none AGE_RECIPIENT_FILE="$WORK/age.pub" "$scripts/dump-immutable.sh" >/dev/null
dump="$(ls "$WORK"/dumps/*.dump.age)"
if age --decrypt --identity /dev/null "$dump" >/dev/null 2>&1; then fail "dump decrypts without the key"; fi
head -c 200 "$dump" | grep -q "age-encryption.org" || fail "dump is not an age file"

echo "== disaster: rows deleted by mistake"
psql_q "delete from pagos"

echo "== point-in-time restore to $target"
"$scripts/restore.sh" --time "$target" --yes
count="$(psql_q 'select count(*) from pagos')"
after="$(psql_q "select count(*) from pagos where nota like 'despues-%'")"
[[ "$count" == "500" && "$after" == "0" ]] || fail "PITR restored $count rows ($after after the target)"
ls -d "$WORK"/pgdata.before-restore-* >/dev/null || fail "previous data directory was not kept"

echo "== restore the encrypted dump into a new database"
"$scripts/restore-dump.sh" "$dump" "$WORK/age.key" mesa_recuperada
[[ "$(compose exec -T -u postgres postgres psql -d mesa_recuperada -Atc 'select count(*) from pagos')" == "700" ]] \
  || fail "dump restore has wrong row count"
if "$scripts/restore-dump.sh" "$dump" "$WORK/age.key" mesa_recuperada 2>/dev/null; then
  fail "restore-dump overwrote an existing database"
fi

echo "== repository is encrypted at rest"
info="$(compose exec -T -u postgres postgres pgbackrest --stanza=mesa info --output=json)"
grep -q '"cipher":"aes-256-cbc"' <<<"$info" || fail "pgBackRest repository is not encrypted"

echo "PASS: backup, PITR and encrypted dump restore"
