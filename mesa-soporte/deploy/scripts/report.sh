#!/usr/bin/env bash
# Publishes custom metrics to OCI Monitoring (namespace "mesa") every few
# minutes: heartbeat, data disk usage and API health. Alarms in Terraform
# watch them (including the *absence* of the heartbeat).
#   report.sh metrics            periodic metrics
#   report.sh backup-ok <0|1>    result of a backup job
#   report.sh alert <unit>       publish a failure notice to the ONS topic
set -euo pipefail
# shellcheck source=deploy/scripts/lib.sh
. "$(dirname "$0")/lib.sh"
require oci jq

: "${COMPARTMENT_ID:?}" "${ALERTS_TOPIC_ID:?}"
host="$(hostname -s)"

post() { # name value
  local now; now="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
  jq -n --arg c "$COMPARTMENT_ID" --arg n "$1" --argjson v "$2" --arg t "$now" --arg h "$host" \
    '[{namespace:"mesa", compartmentId:$c, name:$n, dimensions:{host:$h}, datapoints:[{timestamp:$t, value:$v}]}]' \
    > /tmp/mesa-metric.json
  oci monitoring metric-data post --auth instance_principal --metric-data file:///tmp/mesa-metric.json \
    --endpoint "https://telemetry-ingestion.${OCI_REGION:-mx-queretaro-1}.oraclecloud.com" >/dev/null
  rm -f /tmp/mesa-metric.json
}

case "${1:?metrics|backup-ok|alert}" in
  metrics)
    post heartbeat 1
    used="$(df --output=pcent /srv/mesa | tail -1 | tr -dc '0-9')"
    post disk_used_percent "${used:-0}"
    root_used="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
    post root_disk_used_percent "${root_used:-0}"
    status="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api 2>/dev/null)" 2>/dev/null || echo none)"
    post app_healthy "$([[ "$status" == healthy ]] && echo 1 || echo 0)"
    ;;
  backup-ok) post backup_ok "${2:?0|1}" ;;
  alert)
    unit="${2:?unit}"
    oci ons message publish --auth instance_principal --topic-id "$ALERTS_TOPIC_ID" \
      --title "[mesa-soporte] Falla en $unit ($host)" \
      --body "La unidad $unit falló en $host a las $(date -u +%FT%TZ). Revisa: journalctl -u $unit" >/dev/null
    ;;
  *) die "unknown action" ;;
esac
