#!/usr/bin/env bash
# pgBackRest operations against the running postgres service.
#   backup.sh full|diff|incr   take a backup (creates the stanza on first use)
#   backup.sh check            verify WAL archiving and repository access
#   backup.sh info             show backups
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require docker

kind="${1:?full|diff|incr|check|info}"
STANZA="${BACKUP_STANZA:-mesa}"
pgbr() { compose exec -T -u postgres postgres pgbackrest --stanza="$STANZA" "$@"; }

ensure_stanza() {
  if ! pgbr info --output=json | grep -q '"status":{"code":0'; then
    log "Creating stanza $STANZA"
    pgbr stanza-create
  fi
}

case "$kind" in
  full|diff|incr)
    ensure_stanza
    log "Starting $kind backup"
    pgbr --type="$kind" backup
    log "Backup $kind finished"
    ;;
  check)
    ensure_stanza
    pgbr check
    log "Archive and repository check OK"
    ;;
  info) pgbr info ;;
  *) die "unknown action: $kind" ;;
esac
