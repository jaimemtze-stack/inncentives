#!/usr/bin/env bash
# Exercises deployer.sh with stubbed docker/cosign/curl: happy path, signature
# failure, unpinned images, no-op and automatic rollback.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/state" "$T/home"
pass=0
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok - $*"; pass=$((pass + 1)); }

digest() { printf 'ghcr.io/neitek/mesa-%s@sha256:%064d' "$1" "$2"; }

write_release() { # version digest-seed [unpinned]
  local v="$1" n="$2"
  local api; api="$(digest api "$n")"
  [[ "${3:-}" == "unpinned" ]] && api="ghcr.io/neitek/mesa-api:latest"
  cat > "$T/release.json" <<JSON
[{"tag_name":"inncentives-v9.9","draft":false,"prerelease":false,"assets":[]},
 {"tag_name":"mesa-v99","draft":true,"prerelease":false,"assets":[]},
 {"tag_name":"$v","draft":false,"prerelease":false,"assets":[{"name":"manifest.json","url":"https://api.github.com/repos/neitek/mesa/releases/assets/1"}]}]
JSON
  cat > "$T/manifest.json" <<JSON
{"version":"$v","images":{"api":"$api","worker":"$(digest worker "$n")","web":"$(digest web "$n")","migrator":"$(digest migrator "$n")","postgres":"$(digest postgres "$n")"}}
JSON
}

cat > "$T/bin/curl" <<'EOF2'
#!/usr/bin/env bash
for a in "$@"; do
  case "$a" in
    */releases\?per_page=30) cat "$STUB_DIR/release.json"; exit 0 ;;
    */releases/assets/*) cat "$STUB_DIR/manifest.json"; exit 0 ;;
  esac
done
exit 22
EOF2
cat > "$T/bin/cosign" <<'EOF2'
#!/usr/bin/env bash
echo "cosign $*" >> "$STUB_DIR/calls.log"
exit "${COSIGN_RC:-0}"
EOF2
cat > "$T/bin/docker" <<'EOF2'
#!/usr/bin/env bash
echo "docker $*" >> "$STUB_DIR/calls.log"
case "$*" in
  *"ps -q api"*) echo "cid-api" ;;
  inspect*) echo "${HEALTH:-healthy}" ;;
  *"pgbackrest"*"info"*) echo '[{"status":{"code":0}}]' ;;
esac
exit 0
EOF2
chmod +x "$T/bin/"*

export PATH="$T/bin:$PATH" STUB_DIR="$T"
export MESA_HOME="$T/home" MESA_STATE_DIR="$T/state" GITHUB_REPO="neitek/mesa"
export COMPOSE_FILE="$T/home/docker-compose.prod.yml" COMPOSE_ENV_FILE="$T/home/images.env"
export GITHUB_TOKEN_FILE="$T/none" GHCR_TOKEN_FILE="$T/none" HEALTH_TIMEOUT=10
run() { "$here/../scripts/deployer.sh" 2>"$T/stderr.log"; }

# 1. First deployment.
write_release mesa-v1.0.0 1
run || fail "first deployment failed: $(cat "$T/stderr.log")"
grep -q "IMAGE_API=$(digest api 1)" "$COMPOSE_ENV_FILE" || fail "images.env not written"
[[ "$(cat "$T/state/deploy/current-version")" == mesa-v1.0.0 ]] || fail "current-version"
grep -q "run --rm migrator" "$T/calls.log" || fail "migrations did not run"
grep -qF -- '--certificate-identity-regexp ^https://github.com/neitek/mesa/.github/workflows/mesa-soporte-release.yml@refs/heads/main$ --certificate-oidc-issuer https://token.actions.githubusercontent.com' "$T/calls.log" \
  || fail "cosign identity not pinned to the release workflow on main"
[[ "$(grep -c '^cosign verify' "$T/calls.log")" == 5 ]] || fail "not every image was verified"
grep -q "pgbackrest" "$T/calls.log" && fail "no backup expected before the first deployment"
ok "first deployment verifies 5 signatures, migrates and records the version"

# 2. Same version again: no-op.
: > "$T/calls.log"
run || fail "no-op run failed"
grep -q "compose" "$T/calls.log" && fail "no-op touched compose"
ok "same version is a no-op"

# 3. Bad signature: nothing changes.
write_release mesa-v1.1.0 2
: > "$T/calls.log"
if COSIGN_RC=1 run; then fail "accepted an unsigned image"; fi
grep -q "IMAGE_API=$(digest api 1)" "$COMPOSE_ENV_FILE" || fail "images.env changed after signature failure"
grep -q " up -d" "$T/calls.log" && fail "compose up ran after signature failure"
ok "signature failure leaves the running version untouched"

# 4. Unpinned image reference is refused.
write_release mesa-v1.1.1 3 unpinned
if run; then fail "accepted an image without digest"; fi
grep -q "must be pinned by digest" "$T/stderr.log" || fail "wrong error for unpinned image"
ok "images must be pinned by digest"

# 5. Unhealthy new version: backup first, then automatic rollback.
write_release mesa-v1.2.0 4
: > "$T/calls.log"
if HEALTH=unhealthy run; then fail "unhealthy deployment reported success"; fi
grep -q "pgbackrest --stanza=mesa --type=incr backup" "$T/calls.log" || fail "no pre-deployment backup"
grep -q "IMAGE_API=$(digest api 1)" "$COMPOSE_ENV_FILE" || fail "rollback did not restore previous images"
[[ "$(cat "$T/state/deploy/current-version")" == mesa-v1.0.0 ]] || fail "current-version changed after rollback"
grep -q "mesa-v1.2.0 ROLLED_BACK" "$T/state/deploy/history" || fail "rollback not recorded"
ok "unhealthy release is rolled back after a pre-deployment backup"

echo "PASS: deployer ($pass checks)"
