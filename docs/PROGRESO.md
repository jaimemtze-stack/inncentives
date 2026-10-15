# Progreso — Mesa de soporte de Inncentives

> Documento vivo. Se actualiza al cerrar cada bloque de trabajo.
> Leyenda: ✅ terminado · 🟡 en curso · ⬜ pendiente · ⛔ bloqueado

## Resumen

| Fase | Estado | Notas |
|---|---|---|
| Fase 0 — Cimientos | 🟡 casi terminada | Código y pruebas listos (161 unitarias/integración + 4 E2E); falta validar CI y Compose en GitHub. |
| Fase 1 — MVP | ⬜ | Arranca cuando la fase 0 cumpla la Definición de terminado. |
| Fase 2 — Conocimiento, integraciones, reportes | ⬜ | — |
| Fase 3 — Canales adicionales e Inncentives | ⬜ | — |

## Fase 0 — Cimientos

Detalle y riesgos: [`docs/fases/fase-0.md`](fases/fase-0.md).

### Documentación inicial
- ✅ `docs/PROGRESO.md` con desglose de fase 0 y fase 1.
- ✅ ADRs `docs/decisiones/0001`–`0008`.
- ✅ Modelo de amenazas inicial (`docs/seguridad/modelo-amenazas.md`).
- ✅ Matriz ASVS inicial con rutas a código y pruebas (`docs/seguridad/matriz-asvs.md`).
- ✅ `SECURITY.md` y `docs/seguridad/respuesta-incidentes.md`.
- ✅ Guía de despliegue inicial (`docs/despliegue.md`).

### Repositorio y herramientas
- ✅ Monorepo pnpm: `apps/api`, `apps/web`, `apps/worker`, `packages/shared`, `e2e`.
- ✅ TypeScript strict, ESLint (prohíbe `$queryRawUnsafe`), Prettier, Vitest.
- ✅ `docker-compose.yml` (Postgres, Redis, MinIO, ClamAV, Mailpit + perfil `app`) con contenedores endurecidos.
- ✅ `Dockerfile` multi-stage: api y worker en distroless `nonroot`, web en nginx sin privilegios.
- ✅ CI GitHub Actions: formato, lint, typecheck, pruebas con cobertura, Semgrep, `pnpm audit`, gitleaks, Trivy, prueba de Compose; Dependabot.

### `packages/shared` (102 pruebas, cobertura 97 %)
- ✅ Calendario laboral con festivos de México por regla (pruebas 2024–2030, incluye 1 de octubre sexenal y Semana Santa opcional).
- ✅ Tiempo hábil y SLA: primera respuesta, actualización, solución, pausas, "en riesgo" al 80 %.
- ✅ Detector de datos sensibles (RFC, CURP, NSS, CLABE, tarjetas con Luhn, columnas de sueldo) y redacción.
- ✅ Motor de plantillas con lista blanca de variables y escape HTML.
- ✅ Escape de fórmulas CSV/XLSX; número de ticket y parser de asunto.
- ✅ Sanitización HTML en servidor (21 vectores OWASP), bloqueo de imágenes remotas.
- ✅ Esquemas Zod de autenticación, paginación y cadenas seguras para cabeceras.

### `apps/api` (52 pruebas, cobertura 92 %)
- ✅ Configuración validada con Zod; secretos por archivo, entorno o Key Vault (Managed Identity).
- ✅ Logger pino con redacción; filtro de errores sin trazas al cliente; ID de correlación.
- ✅ Cabeceras de seguridad, CORS cerrado, límite de cuerpo, rate limiting global en Redis.
- ✅ `AccessGuard` global *deny-by-default* + prueba que recorre todas las rutas.
- ✅ Separación de hosts portal/agentes (cookies distintas; admin/agente solo en su host).
- ✅ `PolicyService` único con filtros de consulta (cliente / organización compartida / grupos por nivel).
- ✅ AuditLog append-only (trigger de BD) con cadena de hash verificable y API de consulta.
- ✅ Esquema Prisma del dominio completo + búsqueda `tsvector` es/en (migración SQL).
- ✅ Argon2id, HIBP k-anonymity, bloqueo progresivo por cuenta e IP, mensajes no enumerables.
- ✅ Sesiones en Redis (solo hash), `__Host-`, rotación, inactividad 30 min, absoluta 12 h, listado/revocación.
- ✅ CSRF *double submit* firmado y ligado a la sesión.
- ✅ TOTP (RFC 6238) con anti-repetición, códigos de recuperación, MFA obligatorio para agentes/admins.
- ✅ Invitaciones (admin: cualquier rol; agente: solo clientes) y recuperación de contraseña con tokens de un solo uso.
- ✅ Reautenticación para cambiar MFA; notificación de nuevo dispositivo, cambio de contraseña y de MFA.
- ✅ `/health` y `/ready`; seed de referencia y de demostración (ficticio).

### `apps/worker` y `apps/web`
- ✅ Worker BullMQ: correo transaccional (plantillas es-MX/en escapadas) con adaptadores SMTP/Mailpit y Microsoft Graph.
- ✅ SPA React + TanStack + Tailwind + i18next: login, MFA, alta de MFA con QR, recuperación, invitación, sesiones activas.
- ✅ Playwright: 4 flujos en navegador real contra API + SPA (login, error genérico, idioma, alta de MFA de agente en host separado).

### Pendiente para cerrar la fase 0 (Definición de terminado)
- ⬜ Primera ejecución del CI en GitHub Actions y corrección de hallazgos (Semgrep, `pnpm audit`, Trivy, Compose).
- ⬜ `docker compose --profile app up` verificado desde cero en un host con Docker (este entorno no tiene daemon).
- ⬜ Integrar Playwright al CI (requiere el stack de Compose).
- ⬜ Rol de BD de la aplicación separado del propietario + `REVOKE UPDATE, DELETE` en `audit_logs`.

## Fase 1 — MVP (desglose)

### Tickets (4.1)
- ⬜ CRUD de tickets y artículos con DTOs por rol (cliente nunca ve `internal`).
- ⬜ Vista de ticket: hilo, barra lateral, editor TipTap con tipos de artículo.
- ⬜ Responder / responder a todos / reenviar / citar / nota interna.
- ⬜ Cambios de estado, prioridad, grupo, propietario y campos en la misma acción.
- ⬜ Fusión, división de artículo, vínculos padre/hijo/relacionado.
- ⬜ Etiquetas con autocompletado; gestión por admins.
- ⬜ @menciones y suscripciones.
- ⬜ Colisión en tiempo real (Socket.IO + Redis, rooms autorizados).
- ⬜ Borradores locales y compartidos.
- ⬜ Macros, módulos de texto `::`, plantillas, firmas (motor seguro ya disponible en `shared`).
- ⬜ Historial por ticket.
- ⬜ Acciones masivas y atajos de teclado.
- ⬜ Contabilidad de tiempo y resumen por ticket/cliente/mes.

### Correo (4.2)
- ⬜ Interfaz `MailAdapter`; adaptadores Graph, IMAP/SMTP; Mailpit en local.
- ⬜ Hilos por `In-Reply-To`/`References` y por número en asunto (parser ya en `shared`).
- ⬜ Filtros postmaster.
- ⬜ Protección contra bucles y límite de respuestas automáticas.
- ⬜ Identificación del remitente y grupo "Por verificar" (SPF/DKIM/DMARC).
- ⬜ Salida con cola, reintentos y estado de entrega.
- ⬜ Sanitización HTML, bloqueo de imágenes remotas, `cid:` → adjuntos.

### Teléfono (4.3)
- ⬜ Registro manual de llamadas y búsqueda por número.
- ⬜ `TelephonyProvider` + webhook CTI genérico con HMAC.

### Portal de clientes (4.4)
- ⬜ Invitación (backend listo en fase 0), mis tickets, tickets de la organización, crear/responder/cerrar/reabrir.
- ⬜ Perfil: idioma, contraseña, MFA, sesiones, notificaciones.

### Automatización (4.5, 4.6)
- ⬜ Motor de condiciones compartido (triggers, workflows, vistas, SLAs).
- ⬜ Triggers con protección contra bucles.
- ⬜ Schedulers.
- ⬜ Core Workflows aplicados en cliente y servidor.
- ⬜ SLAs por condición con calendario (cálculo ya en `shared`), escalamiento y notificaciones.
- ⬜ Asignación automática opcional y ausencias con sustituto.

### Vistas, búsqueda, notificaciones (4.7, 4.8)
- ⬜ Vistas predefinidas y configurables.
- ⬜ Búsqueda `tsvector` es/en con sintaxis de filtros, filtrada por el *policy service*.
- ⬜ Notificaciones en la app y por correo con preferencias.

### Adjuntos y datos sensibles (5.6, 5.7)
- ⬜ Subida con lista blanca + magic bytes, ClamAV, cuarentena, URL firmada ≤5 min.
- ⬜ Detector de datos sensibles en artículos y adjuntos (detector ya en `shared`), redacción auditada.
- ⬜ Retención (deshabilitada por defecto), exportación ARCO y anonimización.

### Administración (4.11)
- ⬜ Pantallas de administración para todo lo anterior y gestor de objetos.
- ⬜ "Ver como cliente" con motivo, banner, 15 min y auditoría.
- ⬜ Vista de auditoría.

### Documentación de la fase 1
- ⬜ Manual de administrador y de agente breves; `docs/fases/fase-1.md`.

## Riesgos abiertos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Clientes adjuntan nómina real | Alto (LFPDPPP) | Detector de datos sensibles, aviso previo, redacción, retención (5.7). |
| Buzón Microsoft 365 aún no existe | Medio | Adaptadores y Mailpit; Graph se prueba con *mocks* hasta tener buzón. |
| Disponibilidad de PostgreSQL Flexible en Mexico Central | Medio | Alternativa en contenedor documentada (ADR-0005). |
| El entorno de desarrollo de esta sesión no tiene daemon Docker | Medio | Pruebas con Postgres/Redis locales; Dockerfile y Compose sin ejecutar todavía: se validan en el job `compose` del CI. |
| `prisma migrate dev` propone borrar el `DEFAULT` de columnas generadas | Bajo | Documentado en `apps/api/prisma/README.md`; revisar cada migración nueva. |
| Definición de niveles N1/N2/N3 y SLAs por cliente pendiente | Bajo | Valores por defecto configurables (sección 10). |
