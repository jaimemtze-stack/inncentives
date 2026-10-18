#!/usr/bin/env bash
# Smoke test of the PRODUCTION compose file with locally built images:
# hardening (read-only, non-root, no secrets in env), network isolation,
# database least privilege and the request path nginx -> API -> PostgreSQL.
# Needs root (or sudo) to give secret files the owners used in production.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose_file="$here/../docker-compose.prod.yml"
P="mesasmoke$$"
WORK="$(mktemp -d)"
fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok - $*"; }

export MESA_SECRETS_DIR="$WORK/secrets" MESA_DATA_DIR="$WORK/data"
env_file="$WORK/stack.env"
cat > "$env_file" <<ENV
PORTAL_HOST=soporte.example.mx
AGENT_HOST=agentes.soporte.example.mx
OCI_NAMESPACE=smoke
MAIL_FROM=Soporte <soporte@example.mx>
MAIL_TRANSPORT=log
BACKUP_ENABLED=false
STORAGE_DRIVER=s3
IMAGE_API=${IMAGE_API:-mesa-api:dev}
IMAGE_WORKER=${IMAGE_WORKER:-mesa-worker:dev}
IMAGE_WEB=${IMAGE_WEB:-mesa-web:dev}
IMAGE_MIGRATOR=${IMAGE_MIGRATOR:-mesa-migrator:dev}
IMAGE_POSTGRES=${IMAGE_POSTGRES:-mesa-postgres:dev}
ENV
dc() { docker compose -p "$P" -f "$compose_file" --env-file "$env_file" "$@"; }
cleanup() {
  local rc=$?
  if [[ $rc -ne 0 ]]; then dc logs --no-color --tail 30 api web postgres >&2 || true; fi
  dc down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$MESA_SECRETS_DIR" "$MESA_DATA_DIR/pgdata" "$MESA_DATA_DIR/redis" "$MESA_DATA_DIR/clamav"
chown 999:1000 "$MESA_DATA_DIR/redis"
chown 5432:5432 "$MESA_DATA_DIR/pgdata"
put() { printf '%s' "$3" > "$MESA_SECRETS_DIR/$1"; chown "$2:$2" "$MESA_SECRETS_DIR/$1"; chmod 0400 "$MESA_SECRETS_DIR/$1"; }
pg_app="$(openssl rand -hex 16)"; pg_mig="$(openssl rand -hex 16)"; redis_pw="$(openssl rand -hex 16)"
put postgres_superuser_password 5432 "$(openssl rand -hex 16)"
put postgres_migrator_password 5432 "$pg_mig"
put postgres_app_password 5432 "$pg_app"
put database_url 65532 "postgresql://app_rw:$pg_app@postgres:5432/mesa?sslmode=require&sslaccept=accept_invalid_certs"
put migrator_database_url 65532 "postgresql://app_migrator:$pg_mig@postgres:5432/mesa?sslmode=require&sslaccept=accept_invalid_certs"
put redis_password 999 "$redis_pw"
put redis_url 65532 "redis://:$redis_pw@redis:6379/0"
put field_encryption_keys 65532 "k1:$(openssl rand -base64 32)"
for s in smtp_username smtp_password cloudflared_token; do put "$s" 0 unused; done
put graph_client_secret 65532 unused
put cti_webhook_secret 65532 "$(openssl rand -hex 24)"
put azure_devops_hook_secret 65532 "$(openssl rand -hex 24)"
for s in azure_devops_pat sso_entra_client_secret; do put "$s" 65532 unused; done
for s in pgbackrest_s3_key pgbackrest_s3_key_secret pgbackrest_cipher_pass; do put "$s" 5432 unused; done

echo "== start data tier, migrate, start the application"
dc up -d --wait postgres redis
dc run --rm migrator >/dev/null 2>&1 || { dc run --rm migrator; fail "migrations"; }
dc up -d --wait api worker web
dc up -d jobs
sleep 10
[[ "$(docker inspect "$(dc ps -q jobs)" --format '{{.State.Running}} {{.RestartCount}}')" == "true 0" ]] || fail "jobs service is not running"
ok "stack is up, the API is healthy and the jobs service runs"

curl_edge() { docker run --rm --network "${P}_edge" curlimages/curl:8.16.0 -s "$@"; }

echo "== request path through nginx"
headers="$(curl_edge -D - -o /dev/null http://web:8080/)"
grep -qi "content-security-policy: default-src 'self'" <<<"$headers" || fail "CSP header missing on the web app"
grep -qi "strict-transport-security" <<<"$headers" || fail "HSTS missing"
area="$(curl_edge -H 'Host: soporte.example.mx' http://web:8080/api/v1/auth/area)"
[[ "$area" == '{"area":"portal"}' ]] || fail "area endpoint: $area"
login="$(curl_edge -H 'Host: soporte.example.mx' -H 'Origin: https://soporte.example.mx' -H 'Content-Type: application/json' \
  -H 'CF-Connecting-IP: 203.0.113.77' -d '{"email":"nadie@example.mx","password":"x"}' http://web:8080/api/v1/auth/login)"
grep -q '"invalid_credentials"' <<<"$login" || fail "login did not reach the database: $login"
ip="$(dc exec -T -u postgres postgres psql -d mesa -Atc "select ip from audit_logs order by id desc limit 1")"
[[ "$ip" == "203.0.113.77" ]] || fail "client IP from the tunnel not recorded (got $ip)"
ws="$(curl_edge -s -o /dev/null -w '%{http_code}' -H 'Host: soporte.example.mx' -H 'Origin: https://soporte.example.mx' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  'http://web:8080/socket.io/?EIO=4&transport=websocket' -m 5 || true)"
[[ "$ws" == "101" ]] || fail "websocket upgrade through nginx (got $ws)"
ok "nginx serves the app with CSP/HSTS, proxies the API and websockets, and the client IP is taken from Cloudflare"

echo "== network isolation"
if curl_edge -m 3 http://api:3000/health >/dev/null 2>&1; then fail "edge network reaches the API directly"; fi
if docker run --rm --network "${P}_app" curlimages/curl:8.16.0 -s -m 3 telnet://postgres:5432 >/dev/null 2>&1; then fail "app network reaches PostgreSQL"; fi
if docker run --rm --network "${P}_data" curlimages/curl:8.16.0 -s -m 5 https://www.google.com >/dev/null 2>&1; then fail "data network reaches the Internet"; fi
ok "edge cannot reach the API, app cannot reach the database, data tier has no Internet"

echo "== container hardening"
api="$(dc ps -q api)"
[[ "$(docker exec "$api" /nodejs/bin/node -e 'process.stdout.write(String(process.getuid()))')" == 65532 ]] || fail "API runs as root"
if docker exec "$api" /nodejs/bin/node -e "require('fs').writeFileSync('/app/x','1')" 2>/dev/null; then fail "API filesystem is writable"; fi
docker inspect "$api" --format '{{json .Config.Env}}' | grep -q 'postgresql://' && fail "database URL found in the environment"
[[ "$(docker inspect "$api" --format '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}}')" == "true [ALL]" ]] || fail "API not read-only / capabilities not dropped"
docker inspect "$api" --format '{{json .HostConfig.SecurityOpt}}' | grep -q 'no-new-privileges' || fail "no-new-privileges missing"
ok "API: uid 65532, read-only root filesystem, all capabilities dropped, secrets only as files"
pg="$(dc ps -q postgres)"
[[ "$(docker inspect "$pg" --format '{{.Config.User}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.CapAdd}}')" == "5432:5432 true [ALL] []" ]] \
  || fail "PostgreSQL is not non-root/read-only/without capabilities"
ok "PostgreSQL: uid 5432, read-only root filesystem, no capabilities"

echo "== database least privilege"
q_app() { dc exec -T -u postgres postgres env PGPASSWORD="$pg_app" psql -h 127.0.0.1 -U app_rw -d mesa -v ON_ERROR_STOP=1 -Atc "$1" 2>&1; }
if q_app "create table hack(id int)" >/dev/null; then fail "app_rw can run DDL"; fi
if q_app "update audit_logs set action='x'" >/dev/null; then fail "app_rw can update the audit log"; fi
q_app "select count(*) from audit_logs" >/dev/null || fail "app_rw cannot read"
grep -q "permission denied" <<<"$(q_app "delete from audit_logs")" || fail "app_rw delete on audit_logs not denied by privileges"
ok "app_rw: no DDL, no UPDATE/DELETE on audit_logs"

# DAST (DAST=1): OWASP ZAP baseline (passive scan + spider) of both hosts
# through the edge network, exactly as cloudflared reaches nginx. Rules
# marked FAIL in zap-rules.tsv fail the run; reports go to $DAST_REPORT_DIR.
if [[ "${DAST:-0}" == 1 ]]; then
  echo "== DAST: OWASP ZAP baseline"
  web_ip="$(docker inspect "$(dc ps -q web)" --format "{{(index .NetworkSettings.Networks \"${P}_edge\").IPAddress}}")"
  mkdir -p "$WORK/zap" && cp "$here/zap-rules.tsv" "$WORK/zap/" && chmod -R a+rwX "$WORK/zap"
  for host in soporte.example.mx agentes.soporte.example.mx; do
    rc=0
    docker run --rm --network "${P}_edge" --add-host "$host:$web_ip" -v "$WORK/zap:/zap/wrk:rw" \
      "${ZAP_IMAGE:-zaproxy/zap-stable:2.16.1}" zap-baseline.py -t "http://$host:8080/" \
      -c zap-rules.tsv -m 2 -r "zap-$host.html" -J "zap-$host.json" -s >/dev/null || rc=$?
    # 0 = clean, 2 = warnings only; 1 = a FAIL rule matched, 3 = scanner error.
    [[ $rc -eq 0 || $rc -eq 2 ]] || fail "ZAP baseline on $host (exit $rc, see zap-$host.html)"
    jq -r --arg h "$host" '.site[].alerts[] | "  \($h) \(.riskdesc) [\(.pluginid)] \(.name)"' "$WORK/zap/zap-$host.json" || true
  done
  if [[ -n "${DAST_REPORT_DIR:-}" ]]; then mkdir -p "$DAST_REPORT_DIR" && cp "$WORK"/zap/zap-* "$DAST_REPORT_DIR"/; fi
  ok "ZAP baseline: no FAIL-level findings on the portal and agents hosts"
fi

echo "PASS: production stack smoke test"
