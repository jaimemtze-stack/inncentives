#!/usr/bin/env bash
# Pull-based deployment. GitHub never holds credentials for the server: this
# script fetches the manifest of the latest APPROVED release, verifies every
# image signature, backs up, migrates, deploys and rolls back on failure.
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require docker cosign curl jq

GITHUB_REPO="${GITHUB_REPO:?owner/repo}"
RELEASE_WORKFLOW="${RELEASE_WORKFLOW:-.github/workflows/mesa-soporte-release.yml}"
TOKEN_FILE="${GITHUB_TOKEN_FILE:-/run/mesa/secrets/github_read_token}"
STATE="$MESA_STATE_DIR/deploy"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
FORCE="${1:-}"
SERVICES=(api worker web migrator postgres)

install -d -m 0750 "$STATE"
exec 9>"$STATE/.lock"
flock -n 9 || { log "Another deployment is running"; exit 0; }

auth=()
[[ -r "$TOKEN_FILE" ]] && auth=(-H "Authorization: Bearer $(cat "$TOKEN_FILE")")

log "Fetching latest release of $GITHUB_REPO"
release="$(curl -fsS --proto '=https' --tlsv1.2 "${auth[@]}" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$GITHUB_REPO/releases/latest")"
version="$(jq -r .tag_name <<<"$release")"
asset_url="$(jq -r '.assets[] | select(.name=="manifest.json") | .url' <<<"$release")"
[[ -n "$version" && "$version" != null && -n "$asset_url" ]] || die "release without manifest.json"

current="$(cat "$STATE/current-version" 2>/dev/null || true)"
if [[ "$version" == "$current" && "$FORCE" != "--force" ]]; then
  log "Already running $version"
  exit 0
fi

manifest="$(curl -fsSL --proto '=https' --tlsv1.2 "${auth[@]}" -H 'Accept: application/octet-stream' "$asset_url")"
[[ "$(jq -r .version <<<"$manifest")" == "$version" ]] || die "manifest version mismatch"

declare -A image
for svc in "${SERVICES[@]}"; do
  ref="$(jq -r --arg s "$svc" '.images[$s]' <<<"$manifest")"
  [[ "$ref" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] || die "image for $svc must be pinned by digest: $ref"
  image[$svc]="$ref"
done

identity="^https://github.com/${GITHUB_REPO}/${RELEASE_WORKFLOW}@refs/heads/main$"
for svc in "${SERVICES[@]}"; do
  log "Verifying signature of ${image[$svc]}"
  cosign verify --certificate-identity-regexp "$identity" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com "${image[$svc]}" >/dev/null \
    || die "signature verification failed for $svc; nothing was changed"
done

new_env="$STATE/images-$version.env"
{
  echo "MESA_VERSION=$version"
  echo "IMAGE_API=${image[api]}"
  echo "IMAGE_WORKER=${image[worker]}"
  echo "IMAGE_WEB=${image[web]}"
  echo "IMAGE_MIGRATOR=${image[migrator]}"
  echo "IMAGE_POSTGRES=${image[postgres]}"
} > "$new_env"

previous_env="$COMPOSE_ENV_FILE.previous"
[[ -f "$COMPOSE_ENV_FILE" ]] && cp -f "$COMPOSE_ENV_FILE" "$previous_env"

COMPOSE_ENV_FILE="$new_env" compose pull api worker web migrator postgres

if [[ -n "$current" ]]; then
  log "Pre-deployment backup"
  "$(dirname "$0")/backup.sh" incr
fi

log "Running database migrations"
COMPOSE_ENV_FILE="$new_env" compose run --rm migrator

cp -f "$new_env" "$COMPOSE_ENV_FILE"
compose up -d --remove-orphans

healthy=false
for _ in $(seq 1 $((HEALTH_TIMEOUT / 5))); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || echo unknown)"
  if [[ "$status" == "healthy" ]]; then healthy=true; break; fi
  sleep 5
done

if ! $healthy; then
  log "New version $version is not healthy; rolling back"
  if [[ -f "$previous_env" ]]; then
    cp -f "$previous_env" "$COMPOSE_ENV_FILE"
    compose up -d --remove-orphans
  fi
  echo "$(date -u +%FT%TZ) $version ROLLED_BACK" >> "$STATE/history"
  die "deployment of $version failed; previous version restored (migrations are forward-compatible by policy)"
fi

echo "$version" > "$STATE/current-version"
echo "$(date -u +%FT%TZ) $version DEPLOYED" >> "$STATE/history"
log "Deployed $version"
