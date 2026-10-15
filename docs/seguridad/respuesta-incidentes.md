# Procedimiento de respuesta a incidentes de seguridad

## 1. Clasificación

| Severidad | Ejemplos | Tiempo de respuesta |
|---|---|---|
| Crítica | Acceso no autorizado a datos de clientes, exfiltración, compromiso de credenciales de admin | Inmediato (≤ 1 h) |
| Alta | Vulnerabilidad explotable sin evidencia de explotación, malware en adjuntos entregado | ≤ 4 h |
| Media | Vulnerabilidad con mitigación existente | ≤ 2 días hábiles |
| Baja | Hallazgos informativos | Próximo ciclo |

## 2. Fases

1. **Detección y registro:** abrir un registro de incidente (fuera de la mesa de soporte si está comprometida) con hora, detector y evidencia inicial.
2. **Contención:** revocar sesiones (`DELETE /api/v1/admin/users/:id/sessions`), rotar secretos en Key Vault, deshabilitar integraciones o tokens de API afectados, bloquear en Cloudflare.
3. **Erradicación:** corregir la causa, desplegar, verificar con pruebas.
4. **Recuperación:** restaurar desde respaldo si hay alteración de datos (ver `docs/despliegue.md`); verificar la cadena de hash del AuditLog.
5. **Notificación:**
   - **LFPDPPP (art. 20) y su Reglamento (arts. 63–66):** si hay vulneración que afecte de forma significativa derechos patrimoniales o morales de los titulares, informar **de inmediato** a los titulares (a través de la empresa cliente como responsable cuando Neitek actúa como encargado) con: naturaleza del incidente, datos comprometidos, recomendaciones, acciones correctivas y medios de contacto.
   - **LGPDPPSO** (clientes del sector público): notificar al responsable para que informe al titular y al órgano garante.
   - **GDPR** (clientes sujetos): notificar al responsable sin dilación indebida para que cumpla el plazo de 72 h ante la autoridad.
   - Contratos: cumplir los plazos de notificación pactados con cada cliente.
6. **Lecciones aprendidas:** informe post-mortem en ≤ 10 días hábiles; actualizar el modelo de amenazas y la matriz ASVS.

## 3. Evidencia
- Exportar el AuditLog del periodo (incluye hash de cadena) y logs técnicos; conservar con hash SHA-256 y cadena de custodia.

## 4. Contactos
- Responsable de seguridad de Neitek: *por definir*.
- Correo de reporte: ver `SECURITY.md`.
