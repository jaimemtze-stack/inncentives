# Runbook: rotación de secretos

| Secreto | Frecuencia | Procedimiento |
|---|---|---|
| `pgbackrest_s3_key` / `_secret` (Customer Secret Key) | 90 días | Genera una llave nueva en el usuario `svc-mesa-prod-pgbackrest` → `oci vault secret update-base64` con el nuevo valor → `systemctl restart mesa-secrets-sync` → `docker compose restart postgres` → `backup.sh check` → borra la llave anterior en OCI |
| `github_read_token` | 90 días (caducidad del token) | Nuevo token de solo lectura → actualizar el secreto → `mesa-secrets-sync` |
| `ghcr_read_token` | 90 días (caducidad del token) | Nuevo token clásico solo con `read:packages` → actualizar el secreto → `mesa-secrets-sync` |
| `cloudflared_token` | Si se sospecha fuga | Zero Trust → Tunnel → *Refresh token* → actualizar → reiniciar `cloudflared` |
| `graph_client_secret` | 12 meses (caducidad del secreto en Entra) | Entra → la aplicación → *Certificados y secretos* → nuevo secreto → `oci vault secret update-base64` → `systemctl restart mesa-secrets-sync` → `systemctl restart mesa-stack` → reenvía una invitación y busca `Mail sent (Graph)` en `docker logs mesa-worker-1` → borra el secreto anterior en Entra |
| `smtp_password` | 180 días o al salir alguien del equipo | Nueva contraseña de aplicación → actualizar → reiniciar `worker` |
| `redis_password` (+ `redis_url`) | Anual | Actualiza **ambos** secretos → reinicia `redis`, `api` y `worker` (las sesiones se conservan en el AOF) |
| `postgres_app_password` (+ `database_url`) | Anual | `ALTER ROLE app_rw PASSWORD '…'` (como postgres) → actualizar ambos secretos → reiniciar `api` |
| `field_encryption_keys` | Anual | Agrega una llave nueva **al inicio**, `k2:<base64>,k1:<base64>` (la anterior se queda para descifrar). Los valores se re-cifran al escribirse; quita `k1` cuando `needsRotation` ya no encuentre valores |
| Llave `age` de respaldos | Si se sospecha fuga de la privada | Nueva pareja → nueva llave pública en `/opt/mesa/backup-age-recipient.txt`. Los volcados viejos siguen requiriendo la llave vieja hasta que expiren (90 días) |
| Llave maestra de Vault | Anual | OCI Vault → *Rotate key* (las versiones anteriores siguen descifrando) |

Para volver a traer los secretos usa siempre `systemctl restart mesa-secrets-sync`: el servicio queda activo tras la primera ejecución (`RemainAfterExit=yes`) y `systemctl start` no vuelve a ejecutarlo.

Después de cada rotación: revisa `journalctl -u mesa-secrets-sync` y la bitácora de OCI Audit, y anota la fecha en el registro del SGSI.
