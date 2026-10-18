# Progreso

Última actualización: 18-oct-2026.

## Terminado — Fase 0 (cimientos)

Detalle y evidencia en `fases/fase-0.md`.

- [x] Monorepo pnpm (shared, api, worker, web), lint, formato, tipos estrictos.
- [x] Configuración validada; secretos solo como archivos en producción.
- [x] Autenticación: Argon2id, verificación de contraseñas filtradas, bloqueo progresivo, MFA TOTP (anti-repetición) con códigos de recuperación, reautenticación, sesiones en Redis por host, CSRF en dos capas.
- [x] Invitaciones (sin auto-registro), restablecimiento de contraseña, notificaciones de seguridad por correo.
- [x] Autorización: denegar por defecto, permisos por rol, políticas por objeto, separación portal/agentes por host.
- [x] Bitácora inmutable con hash encadenado.
- [x] Almacenamiento (S3 / OCI con *instance principals*), worker de correo, web es/en.
- [x] Imágenes multi-arquitectura (distroless / nginx no-root / PostgreSQL uid 5432), compose de producción endurecido.
- [x] Infraestructura OCI (Terraform), cloud-init, scripts de operación, despliegue *pull* firmado, respaldos con PITR y volcado inmutable.
- [x] CI/CD (GitHub Actions) y Dependabot.
- [x] Documentación: ADRs, modelo de amenazas, matriz ASVS, guía de despliegue y runbooks.

## Terminado — Fase 1 (MVP)

Detalle y evidencia en `fases/fase-1.md`.

- [x] Tickets completos (artículos, fusión, división, enlaces, menciones, colisión en tiempo real, borradores, macros, módulos de texto, plantillas, firmas, acciones masivas, atajos, historial) y contabilidad de tiempo.
- [x] Correo: Microsoft Graph e IMAP/SMTP, hilos, filtros postmaster, antibucles, verificación del remitente y grupo "Por verificar".
- [x] Teléfono: registro manual, búsqueda por número y webhook CTI genérico firmado.
- [x] Portal de clientes por invitación con acceso por organización.
- [x] Organizaciones, planes, grupos con niveles de acceso, roles personalizados.
- [x] SLAs con calendario de México, escalamientos, triggers, planificadores, Core Workflows, asignación automática y ausencias.
- [x] Vistas, búsqueda de texto completo, notificaciones en la aplicación y por correo.
- [x] Administración de todo lo anterior y campos personalizados; tokens de API; ver como cliente.
- [x] Seguridad de la sección 5 (adjuntos con antivirus, datos sensibles, retención, ARCO, SSRF, tiempo real autorizado).
- [x] Documentación: despliegue, manuales de administrador y agente, ADR-0011 a 0014.

## En espera

- **Aprobación humana para iniciar la fase 2** (regla 9 del prompt).

## Siguiente — Fase 2

Base de conocimiento bilingüe, reportes y tablero, Azure DevOps y Teams, SSO OIDC, WebAuthn, DAST en CI, importación CSV.

## Riesgos abiertos

Ver la sección "Riesgos y pendientes" de `fases/fase-0.md` y `fases/fase-1.md`.
