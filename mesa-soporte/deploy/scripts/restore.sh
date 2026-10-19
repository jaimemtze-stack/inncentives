#!/usr/bin/env bash
# Point-in-time restore with pgBackRest. Never deletes data: the current data
# directory is moved aside (…/pgdata.before-restore-<timestamp>).
#   restore.sh --latest [--yes]
#   restore.sh --time "2026-10-20 13:45:00-06" [--yes]
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require docker

PGDATA_HOST="${PGDATA_HOST:-/srv/mesa/pgdata}"
APP_SERVICES="${APP_SERVICES-api worker}"
mode=""; target=""; yes=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --latest) mode="latest"; shift ;;
    --time) mode="time"; target="${2:?}"; shift 2 ;;
    --yes) yes=true; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done
[[ -n "$mode" ]] || die "use --latest or --time <timestamp>"

if ! $yes; then
  read -r -p "Restore PostgreSQL ($mode ${target}) and stop the application? Type RESTORE: " answer
  [[ "$answer" == "RESTORE" ]] || die "aborted"
fi

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
log "Stopping application services: ${APP_SERVICES:-none}"
# shellcheck disable=SC2086
compose stop $APP_SERVICES postgres

aside="${PGDATA_HOST%/}.before-restore-$stamp"
log "Moving current data directory to $aside"
mv "$PGDATA_HOST" "$aside"
install -d -m 0700 -o 5432 -g 5432 "$PGDATA_HOST"   # postgres uid/gid in the image

log "Restoring ($mode ${target})"
if [[ "$mode" == "time" ]]; then
  compose run --rm --no-deps --entrypoint /usr/local/bin/pgbackrest-restore postgres time "$target"
else
  compose run --rm --no-deps --entrypoint /usr/local/bin/pgbackrest-restore postgres latest
fi

log "Starting PostgreSQL (WAL replay may take a while)"
compose up -d postgres
for _ in $(seq 1 120); do
  if compose exec -T -u postgres postgres pg_isready -q -h /var/run/postgresql; then
    in_recovery="$(compose exec -T -u postgres postgres psql -Atc 'select pg_is_in_recovery()')"
    [[ "$in_recovery" == "f" ]] && break
  fi
  sleep 2
done
[[ "$(compose exec -T -u postgres postgres psql -Atc 'select pg_is_in_recovery()')" == "f" ]] \
  || die "PostgreSQL did not finish recovery; previous data kept at $aside"

if [[ -n "$APP_SERVICES" ]]; then
  # shellcheck disable=SC2086
  compose up -d $APP_SERVICES
fi
log "Restore complete. Previous data directory kept at $aside (delete it once verified)."
log "Take a new full backup now: backup.sh full"
