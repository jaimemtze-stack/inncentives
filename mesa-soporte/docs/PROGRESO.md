# Progreso

Última actualización: 17-oct-2026.

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

## En espera

- **Aprobación humana para iniciar la fase 1** (regla 9 del prompt).

## Siguiente — Fase 1 (MVP)

Tickets, correo (Graph + IMAP), teléfono (registro manual + webhook CTI), portal de clientes, SLAs con calendario de México, automatizaciones, vistas y búsqueda, contabilidad de tiempo, detector de datos sensibles, retención, adjuntos con antivirus.

## Riesgos abiertos

Ver la sección "Riesgos y pendientes" de `fases/fase-0.md`.
