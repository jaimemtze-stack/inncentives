#!/usr/bin/env bash
# Restores an age-encrypted logical dump into a NEW database (never over an
# existing one), for inspection or to recover specific records.
#   restore-dump.sh <dump.age> <age-identity-file> <new_db_name>
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require docker age

dump="${1:?dump file}"; identity="${2:?age identity file}"; newdb="${3:?new database name}"
[[ "$newdb" =~ ^[a-z][a-z0-9_]{2,40}$ ]] || die "invalid database name"
exists="$(compose exec -T -u postgres postgres psql -Atc "select 1 from pg_database where datname='$newdb'")"
[[ -z "$exists" ]] || die "database $newdb already exists"

compose exec -T -u postgres postgres createdb "$newdb"
age --decrypt --identity "$identity" "$dump" \
  | compose exec -T -u postgres postgres pg_restore --no-owner --exit-on-error --dbname="$newdb"
log "Dump restored into database $newdb"
