#!/usr/bin/env bash
# Exercises secrets-sync.sh with a stubbed OCI CLI.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/dest"
fail() { echo "FAIL: $*" >&2; exit 1; }

cat > "$T/bin/oci" <<'EOF2'
#!/usr/bin/env bash
# Records the auth mode and returns base64 content keyed by the secret OCID.
echo "$*" >> "$STUB_DIR/oci.log"
id=""; while [[ $# -gt 0 ]]; do [[ "$1" == "--secret-id" ]] && id="$2"; shift; done
case "$id" in
  ocid1.vaultsecret.oc1.mx-queretaro-1.db) printf 'postgresql://app_rw:s3cr3t@postgres:5432/mesa?sslmode=require' | base64 ;;
  ocid1.vaultsecret.oc1.mx-queretaro-1.redis) printf 'redis://:pw@redis:6379/0' | base64 ;;
  ocid1.vaultsecret.oc1.mx-queretaro-1.empty) printf '' ;;
  *) exit 1 ;;
esac
EOF2
chmod +x "$T/bin/oci"
export PATH="$T/bin:$PATH" STUB_DIR="$T" SECRETS_DEST="$T/dest" SECRETS_MAP="$T/map"
uid="$(id -u)"

cat > "$T/map" <<MAP
# name  ocid  owner  mode
database_url ocid1.vaultsecret.oc1.mx-queretaro-1.db $uid
redis_url    ocid1.vaultsecret.oc1.mx-queretaro-1.redis $uid 0440
MAP

# Refuses a destination that is not a tmpfs.
if REQUIRE_TMPFS=true "$here/../scripts/secrets-sync.sh" 2>/dev/null; then
  [[ "$(stat -f -c %T "$T/dest")" == tmpfs ]] || fail "accepted a non-tmpfs destination"
fi

REQUIRE_TMPFS=false "$here/../scripts/secrets-sync.sh" 2>/dev/null || fail "sync failed"
[[ "$(cat "$T/dest/database_url")" == "postgresql://app_rw:s3cr3t@postgres:5432/mesa?sslmode=require" ]] || fail "content"
[[ "$(stat -c %a "$T/dest/database_url")" == 400 ]] || fail "default mode must be 0400"
[[ "$(stat -c %a "$T/dest/redis_url")" == 440 ]] || fail "explicit mode not applied"
grep -q -- "--auth instance_principal" "$T/oci.log" || fail "must use instance principals"
compgen -G "$T/dest/.tmp.*" >/dev/null && fail "temporary files left behind"

echo "database_url ocid1.vaultsecret.oc1.mx-queretaro-1.empty $uid" > "$T/map"
if REQUIRE_TMPFS=false "$here/../scripts/secrets-sync.sh" 2>/dev/null; then fail "accepted an empty secret"; fi
[[ "$(cat "$T/dest/database_url")" == postgresql* ]] || fail "empty secret overwrote the previous value"

echo "../etc/passwd ocid1.vaultsecret.oc1.x $uid" > "$T/map"
if REQUIRE_TMPFS=false "$here/../scripts/secrets-sync.sh" 2>/dev/null; then fail "accepted a path-like name"; fi

echo "PASS: secrets-sync"
