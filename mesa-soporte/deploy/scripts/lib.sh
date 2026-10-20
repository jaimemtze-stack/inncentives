#!/usr/bin/env bash
# Shared helpers for the operation scripts. Sourced, not executed.
# shellcheck disable=SC2034

MESA_HOME="${MESA_HOME:-/opt/mesa}"
MESA_STATE_DIR="${MESA_STATE_DIR:-/var/lib/mesa}"
COMPOSE_FILE="${COMPOSE_FILE:-$MESA_HOME/docker-compose.prod.yml}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-$MESA_HOME/images.env}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-mesa}"

log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${0##*/}" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require() {
  local c
  for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "missing command: $c"; done
}

compose() {
  local envs=()
  # Services under a profile (clamav) only start when the profile is active.
  export COMPOSE_PROFILES="${COMPOSE_PROFILES:-default}"
  # Static settings (hosts, region) written by cloud-init, then pinned images.
  [[ -f "$MESA_HOME/stack.env" ]] && envs+=(--env-file "$MESA_HOME/stack.env")
  envs+=(--env-file "$COMPOSE_ENV_FILE")
  docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "${envs[@]}" "$@"
}
