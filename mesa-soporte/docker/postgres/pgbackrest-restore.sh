#!/usr/bin/env bash
# Restores the cluster into an EMPTY data directory with pgBackRest.
# Runs as the postgres user (uid 5432):
#   pgbackrest-restore latest
#   pgbackrest-restore time "2026-10-20 13:45:00-06"
set -euo pipefail
mode="${1:?latest|time}"
target="${2:-}"
if [[ -n "$(ls -A "$PGDATA" 2>/dev/null)" ]]; then
  echo "Refusing to restore: $PGDATA is not empty (move it aside first)." >&2
  exit 1
fi
/usr/local/bin/pgbackrest-render
chmod 0700 "$PGDATA"
args=(--stanza="${BACKUP_STANZA:-mesa}" --delta)
case "$mode" in
  latest) args+=(--type=default) ;;
  time) args+=(--type=time "--target=${target:?target time required}" --target-action=promote) ;;
  *) echo "unknown mode: $mode" >&2; exit 1 ;;
esac
exec pgbackrest "${args[@]}" restore
