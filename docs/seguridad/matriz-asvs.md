# Matriz OWASP ASVS 4.0 nivel 2 (seguimiento)

> Estado: ✅ implementado y probado · 🟡 parcial · ⬜ pendiente · N/A no aplica.
> Se actualiza con cada fase. Solo se listan los requisitos aplicables; el resto se documentará al cerrar la fase 1.

| ASVS | Requisito | Implementación | Prueba | Estado |
|---|---|---|---|---|
| V1.4.1 | Control de acceso aplicado en un punto de confianza (servidor) | `apps/api/src/common/auth/permission.guard.ts` | `permission.guard.spec.ts`, `routes-coverage.spec.ts` | ✅ |
| V1.4.4 | Mecanismo único de control de acceso | `apps/api/src/common/policy/policy.service.ts` | `policy.service.spec.ts` | ✅ |
| V2.1.1 | Contraseña ≥ 12 caracteres | `packages/shared/src/schemas/auth.ts` | `auth.schema.spec.ts` | ✅ |
| V2.1.7 | Verificación contra contraseñas filtradas | `apps/api/src/modules/auth/password.service.ts` (HIBP k-anonymity) | `password.service.spec.ts` | ✅ |
| V2.1.9 | Sin reglas de composición | `packages/shared/src/schemas/auth.ts` | `auth.schema.spec.ts` | ✅ |
| V2.2.1 | Controles anti-automatización | `apps/api/src/modules/auth/login-throttle.service.ts` | `login-throttle.service.spec.ts` | ✅ |
| V2.4.1 | Almacenamiento de contraseñas resistente (Argon2id) | `password.service.ts` | `password.service.spec.ts` | ✅ |
| V2.5.2 | Sin preguntas secretas; recuperación por token | `auth.service.ts` | `auth.e2e.spec.ts` | ✅ |
| V2.5.6 | Token de recuperación de un solo uso con caducidad | `one-time-token.service.ts` | `auth.e2e.spec.ts` | ✅ |
| V2.8.1 | TOTP con ventana limitada | `totp.service.ts` | `totp.service.spec.ts` | ✅ |
| V3.2.1 | Nuevo token de sesión al autenticarse | `session.service.ts` (`rotate`) | `auth.e2e.spec.ts` | ✅ |
| V3.3.1 | Logout invalida la sesión | `session.service.ts` | `auth.e2e.spec.ts` | ✅ |
| V3.3.2 | Expiración por inactividad y absoluta | `session.service.ts` | `session.service.spec.ts` | ✅ |
| V3.3.4 | Ver y revocar sesiones activas | `sessions.controller.ts` | `auth.e2e.spec.ts` | ✅ |
| V3.4.1–3 | Cookie Secure, HttpOnly, SameSite | `session.cookie.ts` | `auth.e2e.spec.ts` | ✅ |
| V3.4.4 | Prefijo `__Host-` | `session.cookie.ts` | `auth.e2e.spec.ts` | ✅ |
| V3.7.1 | Reautenticación para acciones sensibles | `reauth.guard.ts` | `auth.e2e.spec.ts` | ✅ |
| V4.1.3 | Mínimo privilegio | Roles/permisos por grupo | `policy.service.spec.ts` | 🟡 |
| V4.1.5 | Denegar por defecto | `permission.guard.ts` | `routes-coverage.spec.ts` | ✅ |
| V4.2.1 | Protección IDOR | `PolicyService` | Matriz de autorización (fase 1) | 🟡 |
| V4.2.2 | Protección CSRF | `csrf.guard.ts` | `auth.e2e.spec.ts` | ✅ |
| V5.1.3 | Validación de entrada positiva (lista blanca) | Esquemas Zod en `packages/shared` | Pruebas de esquemas | ✅ |
| V5.2.1 | Sanitización de HTML no confiable | `packages/shared/src/html/sanitize.ts` | `sanitize.spec.ts` | 🟡 |
| V5.2.6 | Protección SSRF | Fase 1/2 | — | ⬜ |
| V5.3.4 | Consultas parametrizadas | Prisma; regla Semgrep | CI | ✅ |
| V7.1.1 | No registrar credenciales ni tokens | `logger.ts` (redacción) | `logger.spec.ts` | ✅ |
| V7.1.3 | Registrar eventos de seguridad | `audit.service.ts` | `audit.service.spec.ts` | ✅ |
| V7.3.4 | Protección de integridad de logs | Cadena de hash + trigger BD | `audit.service.spec.ts` | ✅ |
| V8.3.4 | Datos sensibles identificados y con política | Detector `packages/shared/src/sensitive` | `detector.spec.ts` | 🟡 |
| V9.1.1 | TLS en todo el tráfico externo | Cloudflare + HSTS | Cabeceras | ✅ |
| V12.1.1 | Límite de tamaño de archivos | `ATTACHMENT_MAX_BYTES` | Fase 1 | ⬜ |
| V12.4.1 | Archivos fuera del webroot, privados | ADR-0003 | Fase 1 | ⬜ |
| V13.2.3 | CORS restringido | `main.ts` | `security-headers.e2e.spec.ts` | ✅ |
| V14.2.1 | Dependencias actualizadas | Dependabot + `pnpm audit` | CI | ✅ |
| V14.4.3 | CSP | `security-headers.ts` | `security-headers.e2e.spec.ts` | ✅ |
| V14.4.5 | HSTS | `security-headers.ts` | `security-headers.e2e.spec.ts` | ✅ |

## ISO 27001:2022 Anexo A (controles relacionados)

| Control | Cómo se atiende |
|---|---|
| A.5.15 Control de acceso | ADR-0002 |
| A.5.17 Información de autenticación | ADR-0006 |
| A.5.33/A.5.34 Protección de registros y de datos personales | AuditLog, detector, retención, ARCO |
| A.8.5 Autenticación segura | MFA, Argon2id |
| A.8.12 Prevención de fuga de datos | Detector de datos sensibles, DTOs por rol |
| A.8.13 Respaldos | `docs/despliegue.md` |
| A.8.15 Registro | AuditLog + logs pino |
| A.8.24 Criptografía | AES-256-GCM, TLS |
| A.8.25–A.8.29 Desarrollo seguro | CI con SAST, SCA, secretos, Trivy |
