#!/usr/bin/env bash
# Fetches secrets from OCI Vault with the instance principal (no keys on the
# server) and writes them to a tmpfs, one file per secret, mode 0400.
# Map file lines:  <name> <secret-ocid> <owner-uid> [mode]
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require oci base64 install

MAP="${SECRETS_MAP:-$MESA_HOME/secrets.map}"
DEST="${SECRETS_DEST:-/run/mesa/secrets}"
REQUIRE_TMPFS="${REQUIRE_TMPFS:-true}"
[[ -r "$MAP" ]] || die "map file not readable: $MAP"

install -d -m 0711 "$DEST"
if [[ "$REQUIRE_TMPFS" == "true" ]]; then
  fstype="$(stat -f -c %T "$DEST")"
  [[ "$fstype" == "tmpfs" || "$fstype" == "ramfs" ]] || die "$DEST must be on tmpfs (found $fstype)"
fi

umask 077
count=0
while read -r name ocid owner mode; do
  [[ -z "${name:-}" || "${name:0:1}" == "#" ]] && continue
  [[ "$name" =~ ^[a-z0-9_]+$ ]] || die "invalid secret name: $name"
  [[ "$ocid" =~ ^ocid1\.vaultsecret\. ]] || die "invalid secret OCID for $name"
  [[ "$owner" =~ ^[0-9]+$ ]] || die "invalid owner uid for $name"
  mode="${mode:-0400}"
  tmp="$(mktemp "$DEST/.tmp.XXXXXX")"
  oci secrets secret-bundle get --auth instance_principal --secret-id "$ocid" \
    --stage CURRENT --query 'data."secret-bundle-content".content' --raw-output \
    | base64 --decode > "$tmp"
  [[ -s "$tmp" ]] || { rm -f "$tmp"; die "secret $name is empty"; }
  chown "$owner:$owner" "$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$DEST/$name"
  count=$((count + 1))
done < "$MAP"
log "Synchronised $count secrets into $DEST"
