#!/usr/bin/env bash
# Creates the application secrets in OCI Vault and prints the secrets.map for
# the VM. Run it ONCE from an operator workstation authenticated to OCI
# (oci session authenticate). Generated values never touch the disk except a
# 0600 temp file that is removed immediately; they are not printed.
#
#   bootstrap-secrets.sh <compartment-ocid> <vault-ocid> <key-ocid> [prefix]
set -euo pipefail
for c in oci openssl jq base64; do
  command -v "$c" >/dev/null || { echo "missing command: $c" >&2; exit 1; }
done

comp="${1:?compartment OCID}"; vault="${2:?vault OCID}"; key="${3:?key OCID}"; prefix="${4:-mesa-prod}"
work="$(mktemp -d)"; chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

APP_UID=65532   # distroless nonroot (api, worker, migrator, cloudflared)
REDIS_UID=999   # redis user in redis:alpine
PG_UID=5432     # postgres user in the PostgreSQL image (also pgBackRest)
ROOT_UID=0      # read by root on the host (deployer)
map_lines=()

create() { # name owner value
  local name="$1" owner="$2" value="$3" ocid
  jq -n --arg c "$comp" --arg v "$vault" --arg k "$key" --arg n "$prefix-$name" \
        --arg b "$(printf '%s' "$value" | base64 -w0)" \
    '{compartmentId:$c, vaultId:$v, keyId:$k, secretName:$n, secretContentContent:$b, secretContentName:"v1", secretContentStage:"CURRENT"}' \
    > "$work/s.json"
  # Git Bash on Windows: the native OCI CLI needs a Windows path and prints CRLF.
  local json="$work/s.json"
  command -v cygpath >/dev/null && json="$(cygpath -m "$json")"
  ocid="$(oci vault secret create-base64 --from-json "file://$json" --query 'data.id' --raw-output | tr -d '\r')"
  rm -f "$work/s.json"
  map_lines+=("$name $ocid $owner")
  echo "created $prefix-$name" >&2
}

rand() { openssl rand -base64 "$1" | tr -d '\n/+=' | cut -c1-"$2"; }
ask() { local v; read -r -s -p "$1: " v; echo >&2; printf '%s' "$v"; }

pg_super="$(rand 48 40)"; pg_migrator="$(rand 48 40)"; pg_app="$(rand 48 40)"; redis_pw="$(rand 48 40)"
create postgres_superuser_password "$PG_UID" "$pg_super"
create postgres_migrator_password "$PG_UID" "$pg_migrator"
create postgres_app_password "$PG_UID" "$pg_app"
# Traffic stays on the private Docker network; TLS encrypts it with the
# cluster's self-signed certificate (hence sslaccept=accept_invalid_certs).
create database_url "$APP_UID" "postgresql://app_rw:${pg_app}@postgres:5432/mesa?sslmode=require&sslaccept=accept_invalid_certs&connection_limit=10"
create migrator_database_url "$APP_UID" "postgresql://app_migrator:${pg_migrator}@postgres:5432/mesa?sslmode=require&sslaccept=accept_invalid_certs"
create redis_password "$REDIS_UID" "$redis_pw"
create redis_url "$APP_UID" "redis://:${redis_pw}@redis:6379/0"
create field_encryption_keys "$APP_UID" "k1:$(openssl rand -base64 32)"
create pgbackrest_cipher_pass "$PG_UID" "$(rand 64 60)"
create cti_webhook_secret "$APP_UID" "$(rand 64 48)"
create azure_devops_hook_secret "$APP_UID" "$(rand 64 48)"
create inncentives_widget_secret "$APP_UID" "$(rand 64 48)"
create whatsapp_verify_token "$APP_UID" "$(rand 48 32)"
unset pg_super pg_migrator pg_app redis_pw

echo "Values that come from other systems (input is hidden):" >&2
create pgbackrest_s3_key "$PG_UID" "$(ask 'pgBackRest Customer Secret Key - access key')"
create pgbackrest_s3_key_secret "$PG_UID" "$(ask 'pgBackRest Customer Secret Key - secret')"
create cloudflared_token "$APP_UID" "$(ask 'Cloudflare Tunnel token')"
orunused() { local v; v="$(ask "$1 (Enter = not used yet)")"; printf '%s' "${v:-unused}"; }
create smtp_username "$APP_UID" "$(orunused 'SMTP user (soporte@...)')"
create smtp_password "$APP_UID" "$(orunused 'SMTP password / app credential')"
create graph_client_secret "$APP_UID" "$(orunused 'Microsoft Graph client secret of the support mailbox app')"
create azure_devops_pat "$APP_UID" "$(orunused 'Azure DevOps PAT (Work Items: read & write)')"
create sso_entra_client_secret "$APP_UID" "$(orunused 'Entra ID client secret of the agents SSO app')"
create inncentives_api_token "$APP_UID" "$(orunused 'Inncentives API token (read-only)')"
create twilio_auth_token "$APP_UID" "$(orunused 'Twilio Auth Token (voice and SMS)')"
create whatsapp_access_token "$APP_UID" "$(orunused 'WhatsApp Cloud API system user token')"
create whatsapp_app_secret "$APP_UID" "$(orunused 'Meta app secret (webhook signatures)')"
create anthropic_api_key "$APP_UID" "$(orunused 'Anthropic API key (zero data retention org; only if AI is approved)')"
create github_read_token "$ROOT_UID" "$(ask 'GitHub fine-grained token (this repository only, Contents: read)')"
create ghcr_read_token "$ROOT_UID" "$(ask 'GitHub classic token for GHCR (read:packages only)')"

echo "# name ocid owner-uid   (copy to /opt/mesa/secrets.map on the VM)"
printf '%s\n' "${map_lines[@]}"
