# ADR-0009: Respaldos y recuperación

- **Estado:** aceptada
- **Decisión:**
  - **pgBackRest** con repositorio en `respaldos-pitr` (API S3 de OCI):
    - completo semanal y diferencial diario;
    - WAL continuo (`archive_timeout=60s`);
    - cifrado del lado del cliente AES-256;
    - retención de 35 días;
    - `check` cada hora.
  - **Volcado diario** `pg_dump` cifrado con `age` (solo la llave pública vive en el servidor), con nombre único, en `respaldos-inmutables`. Ese bucket tiene una *retention rule* de 30 días que se bloquea a mano tras la primera prueba de restauración, y una regla de ciclo de vida que lo borra a los 90 días.
  - **`restore.sh` nunca borra:** mueve el directorio de datos actual a `pgdata.before-restore-<fecha>`. `restore-dump.sh` restaura solo en una base **nueva**.
  - **Prueba automática en CI:** respaldo → borrado accidental → restauración a un punto exacto en el tiempo → verificación de filas, más la restauración del volcado cifrado.
- **Objetivos:** RPO ≤ 5 min (≤ 24 h en el peor caso, restaurando el volcado inmutable); RTO ≤ 4 h.
