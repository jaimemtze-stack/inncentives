# Procedimiento de respuesta a incidentes

1. **Detección:** alarmas de OCI (topic `mesa-prod-alerts` → canal de Teams), Cloud Guard, WAF de Cloudflare, reportes de usuarios o el canal de `SECURITY.md`.
2. **Triage (≤ 1 h hábil):** quien está de guardia en `SG-Soporte-Infra` clasifica la severidad (crítica / alta / media / baja) y abre un registro del incidente (fecha, alcance, evidencia).
3. **Contención:**
   - Revocar sesiones: `POST /api/v1/admin/users/:id/sessions/revoke`. Para revocarlas todas, vaciar las llaves `sess:*` de Redis.
   - Rotar los secretos afectados (`runbooks/rotacion-secretos.md`).
   - Bloquear IPs o países en el WAF; poner el host de agentes en "Block" en Cloudflare Access.
   - Si la VM está comprometida: aislarla (quitar el NSG de salida) y **no apagarla** hasta tomar evidencia (instantánea del volumen de arranque).
4. **Erradicación y recuperación:**
   - Reconstruir la VM con Terraform y cloud-init.
   - Restaurar desde pgBackRest o desde el volcado inmutable (`runbooks/restauracion.md`).
   - Volver a desplegar el último release firmado.
5. **Notificación:** si hubo vulneración de datos personales, el área legal evalúa el aviso a los titulares (LFPDPPP, art. 20 de la ley de 2025) y, si aplica, a la autoridad (GDPR art. 33: 72 h). Se informa a los clientes afectados según sus contratos.
6. **Lecciones aprendidas (≤ 10 días):** análisis de causa raíz, acciones correctivas con responsables, y actualización del modelo de amenazas y de esta guía.

Evidencia a conservar: bitácora de la aplicación (`/admin/audit-logs` + verificación de la cadena), OCI Audit, logs de Cloudflare (Access, WAF), `journalctl` de la VM y Log Analytics/OCI Logging.
