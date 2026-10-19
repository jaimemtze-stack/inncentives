# ADR-0005: Secretos como archivos desde OCI Vault

- **Estado:** aceptada
- **Decisión:**
  - **La app solo lee archivos** en `/run/secrets` (Docker secrets). En producción rechaza secretos por variable de entorno y archivos legibles por todos.
  - **En el servidor,** `secrets-sync.sh` usa *instance principals* para leer OCI Vault y escribe en un `tmpfs` (`/run/mesa/secrets`). Cada archivo es `0400`, con el dueño que corresponde (65532 apps, 999 Redis, 0 PostgreSQL/deployer).
  - **Terraform crea el Vault y la llave maestra (HSM), nunca los valores.** Los valores no deben quedar en el estado de Terraform. `infra/scripts/bootstrap-secrets.sh` genera los aleatorios y pide los externos sin mostrarlos.
  - **Cifrado de campos** (semillas TOTP): AES-256-GCM con AAD ligado a la fila, con id de llave para rotar.
- **Excepción:** pgBackRest habla la API compatible con S3, que requiere una *Customer Secret Key*. Es de un usuario de servicio limitado al bucket `respaldos-pitr`, guardada en Vault y rotada cada 90 días.
