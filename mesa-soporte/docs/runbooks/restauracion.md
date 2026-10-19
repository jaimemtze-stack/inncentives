# Runbook: restauración de PostgreSQL

Los scripts están en `/opt/mesa/scripts` del servidor (fuente: `deploy/scripts`). Requieren `sudo`.

## A. Error humano (datos borrados o modificados) — restaurar a un punto en el tiempo

1. Identifica la hora **anterior** al error (bitácora de auditoría o logs), con zona horaria. Ejemplo: `2026-11-03 13:44:00-06`.
2. Avisa en el canal de soporte: la aplicación estará detenida unos minutos.
3. Ejecuta:

   ```bash
   sudo /opt/mesa/scripts/restore.sh --time "2026-11-03 13:44:00-06"
   ```

   Pide escribir `RESTORE`, detiene `api` y `worker` y mueve los datos actuales a `/srv/mesa/pgdata.before-restore-<fecha>` (no los borra). Después restaura, reproduce el WAL hasta la hora indicada, promueve y vuelve a arrancar la aplicación.
4. Verifica en la aplicación. Si necesitas datos posteriores al punto restaurado, están en el directorio movido. Para extraerlos, levanta una copia temporal o pide ayuda al equipo.
5. Toma un respaldo completo: `sudo /opt/mesa/scripts/backup.sh full`.
6. Después de verificar (máximo 7 días), elimina el directorio `.before-restore-…`.

## B. Pérdida del servidor

1. `terraform apply` (recrea la VM; cloud-init instala todo).
2. Pasos 7 y 9 de `despliegue.md` (secretos y accesos).
3. `sudo systemctl start mesa-deployer` (despliega el último release) y `sudo /opt/mesa/scripts/restore.sh --latest --yes`.
4. `sudo /opt/mesa/scripts/backup.sh full`.

RTO objetivo: ≤ 4 h.

## C. Servidor comprometido o repositorio pgBackRest dañado: volcado inmutable

1. Descarga el volcado más reciente **desde un equipo limpio**:

   ```bash
   oci os object list --bucket-name respaldos-inmutables --prefix pgdump/ --query 'data[-1].name'
   oci os object get --bucket-name respaldos-inmutables --name <nombre> --file mesa.dump.age
   ```

2. Copia el archivo y la llave **privada** de `age` (sobre sellado) solo al servidor nuevo y restaura en una base nueva:

   ```bash
   sudo /opt/mesa/scripts/restore-dump.sh mesa.dump.age mesa-backup.key mesa_recuperada
   ```

3. Valida y renombra (`ALTER DATABASE … RENAME`) en una ventana de mantenimiento. Borra la llave privada del servidor al terminar.

RPO en este escenario: ≤ 24 h.

## D. Prueba trimestral obligatoria

Ejecuta el escenario A sobre una copia (VM de pruebas o local con `deploy/tests/backup-restore.test.sh` apuntando al bucket real en modo lectura). Registra la fecha, la duración (RTO real) y el resultado en `docs/fases/` o en el SGSI.
