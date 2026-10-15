# Progreso — Mesa de soporte de Inncentives

> Documento vivo. Se actualiza al cerrar cada bloque de trabajo.
> Leyenda: ✅ terminado · 🟡 en curso · ⬜ pendiente · ⛔ bloqueado

## Resumen

| Fase | Estado | Notas |
|---|---|---|
| Fase 0 — Cimientos | 🟡 en curso | Monorepo, núcleo de dominio compartido, API con autenticación, autorización y auditoría. |
| Fase 1 — MVP | ⬜ | Arranca cuando la fase 0 cumpla la Definición de terminado. |
| Fase 2 — Conocimiento, integraciones, reportes | ⬜ | — |
| Fase 3 — Canales adicionales e Inncentives | ⬜ | — |

## Fase 0 — Cimientos

### Documentación inicial
- ✅ `docs/PROGRESO.md` con desglose de fase 0 y fase 1.
- ✅ ADRs iniciales (`docs/decisiones/0001`–`0006`).
- ✅ Modelo de amenazas inicial (`docs/seguridad/modelo-amenazas.md`).
- ✅ Matriz ASVS inicial (`docs/seguridad/matriz-asvs.md`).
- ✅ `SECURITY.md` y `docs/seguridad/respuesta-incidentes.md`.
- ✅ Guía de despliegue inicial (`docs/despliegue.md`).

### Repositorio y herramientas
- ✅ Monorepo pnpm: `apps/api`, `apps/web`, `apps/worker`, `packages/shared`.
- ✅ TypeScript strict, ESLint, Prettier, Vitest.
- ✅ `docker-compose.yml` local (Postgres, Redis, MinIO, ClamAV, Mailpit, api, worker, web).
- ✅ Dockerfiles multi-stage no-root.
- ✅ CI GitHub Actions: lint, typecheck, pruebas con cobertura, Semgrep, `pnpm audit`, gitleaks, Trivy; Dependabot.

### `packages/shared`
- ✅ Calendario laboral con festivos de México por regla (pruebas multi-año).
- ✅ Cálculo de tiempo hábil y de vencimientos de SLA (pausas, en riesgo al 80 %).
- ✅ Detector de datos sensibles (RFC, CURP, NSS, CLABE, tarjetas con Luhn, columnas de sueldo).
- ✅ Motor de plantillas seguro con lista blanca de variables.
- ✅ Escape de fórmulas para CSV/XLSX.
- ✅ Generador de número de ticket y parser de número en asunto.
- ✅ Esquemas Zod de autenticación y de entidades base.

### `apps/api` (NestJS + Fastify)
- ✅ Configuración por entorno validada con Zod y proveedor de secretos (env / archivo / Docker secrets; Key Vault con adaptador).
- ✅ Logger pino con redacción automática.
- ✅ Filtro global de errores, pipe de validación Zod, ID de correlación.
- ✅ Cabeceras de seguridad (CSP sin `unsafe-inline`, HSTS, etc.), CORS cerrado, límite de cuerpo.
- ✅ Guard global *deny-by-default* (`@RequirePermission` / `@Public`) con prueba que recorre todas las rutas.
- ✅ *Policy service* único con filtros de consulta para tickets (cliente/organización/grupo).
- ✅ AuditLog append-only con cadena de hash y trigger de BD que bloquea UPDATE/DELETE.
- ✅ Esquema Prisma del dominio completo (sección 3) y migración inicial.
- ✅ Autenticación local: Argon2id, política de contraseñas (12+, HIBP k-anonymity desactivable), bloqueo progresivo, mensajes no enumerables.
- ✅ Sesiones en Redis con cookie `__Host-`, rotación, inactividad 30 min, absoluta 12 h, listado y revocación.
- ✅ CSRF *double submit* firmado.
- ✅ TOTP + códigos de recuperación, semilla cifrada AES-256-GCM.
- ✅ Invitaciones y recuperación de contraseña con tokens de un solo uso (hash, caducidad).
- ✅ Reautenticación para acciones sensibles.
- ✅ Separación de hosts (portal / agentes) con guard de host.
- ✅ `/health` y `/ready`.
- ✅ Seed de datos de demostración (ficticios).

### `apps/worker` y `apps/web`
- ✅ Worker BullMQ con colas declaradas (correo, SLA, escaneo, retención) y *graceful shutdown*.
- ✅ SPA React + Vite + i18next (es-MX por defecto, en) con inicio de sesión, MFA y layout de agente/portal.

### Pendiente para cerrar la fase 0
- ⬜ Pruebas E2E Playwright de login + MFA + invitación (requiere entorno con Docker Compose).
- ⬜ Verificar `docker compose up` desde cero en un host con daemon Docker (el contenedor de desarrollo actual no tiene daemon).
- ⬜ Ejecutar CI completo en GitHub Actions y resolver hallazgos.
- ⬜ `docs/fases/fase-0.md` final.

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
| El entorno de desarrollo de esta sesión no tiene daemon Docker | Bajo | Pruebas de integración con Postgres/Redis locales; Compose se valida en CI. |
| Definición de niveles N1/N2/N3 y SLAs por cliente pendiente | Bajo | Valores por defecto configurables (sección 10). |
