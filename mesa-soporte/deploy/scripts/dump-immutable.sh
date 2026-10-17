#!/usr/bin/env bash
# Daily logical dump, encrypted with age on the host (only the public key is
# on the server) and uploaded under a unique name to the bucket protected by a
# retention rule. Objects are never overwritten, so the rule never blocks it.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require docker age sha256sum

AGE_RECIPIENT_FILE="${AGE_RECIPIENT_FILE:-$MESA_HOME/backup-age-recipient.txt}"
UPLOADER="${UPLOADER:-oci}"                      # oci | mc (tests) | none
BUCKET="${IMMUTABLE_BUCKET:-respaldos-inmutables}"
DB="${POSTGRES_DB:-mesa}"
[[ -s "$AGE_RECIPIENT_FILE" ]] || die "age recipient file not found: $AGE_RECIPIENT_FILE"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
name="pgdump/${DB}-${ts}.dump.age"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
out="$work/dump.age"

log "Dumping database $DB"
compose exec -T -u postgres postgres pg_dump --format=custom --no-owner --dbname="$DB" \
  | age --encrypt --recipients-file "$AGE_RECIPIENT_FILE" --output "$out"
[[ -s "$out" ]] || die "empty dump"
sha="$(sha256sum "$out" | cut -d' ' -f1)"
log "Encrypted dump ready: $(stat -c %s "$out") bytes, sha256 $sha"

case "$UPLOADER" in
  oci)
    require oci
    oci os object put --auth instance_principal --bucket-name "$BUCKET" --name "$name" \
      --file "$out" --no-overwrite --metadata "{\"sha256\":\"$sha\"}" >/dev/null
    ;;
  mc)
    require mc
    mc cp --quiet "$out" "${MC_ALIAS:?}/$BUCKET/$name" >/dev/null
    ;;
  none) cp "$out" "${LOCAL_DUMP_DIR:?}/$(basename "$name")" ;;
  *) die "unknown uploader: $UPLOADER" ;;
esac
log "Uploaded $name"
echo "$name"
