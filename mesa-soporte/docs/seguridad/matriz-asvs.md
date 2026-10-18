# Matriz OWASP ASVS 4.0 (nivel 2) — estado al cierre de la fase 2

Leyenda: ✅ implementado y probado · 🟡 parcial / depende de configuración externa · ⏳ fase posterior.

| ASVS | Requisito (resumen) | Estado | Implementación | Prueba |
|---|---|---|---|---|
| 1.2.x | Componentes con privilegio mínimo | ✅ | Roles `app_rw`/`app_migrator`, IAM por bucket, contenedores no-root | *smoke* de producción |
| 1.4.1 | Control de acceso en el servidor | ✅ | `AuthzGuard` global + `PolicyService` | `platform.int.test.ts` |
| 2.1.1–2.1.7 | Contraseñas ≥ 12, sin reglas de composición, verificación contra filtraciones | ✅ | `PasswordSchema`, `PasswordService.isBreached` | `schemas.test.ts`, `crypto.test.ts` |
| 2.2.1 | Anti fuerza bruta | ✅ | `RateLimitService` (IP, cuenta, diario, MFA, reautenticación) | `auth.int.test.ts` |
| 2.2.3 | Notificar cambios de credenciales | ✅ | Correos de cambio de contraseña, MFA y nuevo dispositivo | `auth.int.test.ts` |
| 2.4.1 | Hash de contraseñas resistente | ✅ | Argon2id m=19 MiB, t=2, p=1 | `crypto.test.ts` |
| 2.5.x | Recuperación segura | ✅ | Token de 256 bits de un solo uso, solo hash, 30 min, cierra sesiones | `auth.int.test.ts` |
| 2.7/2.8 | OTP / TOTP de un solo uso | ✅ | `TotpService.verifyOnce`, semilla cifrada AES-GCM | `auth.int.test.ts` |
| 2.8.x | MFA para cuentas privilegiadas | ✅ | Obligatorio para ADMIN/AGENT; opcional por organización para clientes | `auth.int.test.ts`, E2E |
| 2.9.x / 2.10.x | Autenticadores criptográficos (WebAuthn) | ✅ | Passkeys/llaves FIDO2 como segundo factor; RP ID por host, reto por sesión, contador; el personal no puede quitar su último factor | `e2e/webauthn.spec.ts` |
| 2.x / 3.5.x | Federación (OIDC) | ✅ | PKCE + `state`/`nonce` de un solo uso, JWKS, `iss`/`aud`; solo identidades vinculadas por el usuario; MFA propio salvo IdP de confianza | `sso.int.test.ts` |
| 3.2.x | Tokens de sesión aleatorios, rotación al autenticar | ✅ | `SessionService.create/rotate` | `auth.int.test.ts` |
| 3.3.x | Expiración y cierre | ✅ | Inactividad 30 min, absoluta 12 h, *logout*, revocación | `auth.int.test.ts` |
| 3.4.x | Atributos de la cookie | ✅ | `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` | `auth.int.test.ts`, E2E |
| 3.5.x | Defensa CSRF | ✅ | Origin + token de sesión | `platform.int.test.ts`, `auth.int.test.ts` |
| 3.7.1 | Reautenticación para acciones sensibles | ✅ | `@RequireReauth()` (códigos de recuperación, desactivar MFA, reemplazar TOTP) | `auth.int.test.ts` |
| 4.1.x / 4.2.x | Denegar por defecto, IDOR | ✅ | Guard + políticas; `TicketAccessService` por grupo/organización en tickets, búsqueda, adjuntos, tiempo real y "ver como cliente"; 404 fuera de alcance | `auth.int.test.ts`, `admin.int.test.ts`, `tickets.int.test.ts`, `realtime.int.test.ts` |
| 4.3.1 | Interfaces administrativas con MFA | ✅ | Área de agentes + MFA + Cloudflare Access | E2E + `despliegue.md` |
| 5.1.x | Validación de entrada | ✅ | Zod `.strict()` en todo | `schemas.test.ts`, `admin.int.test.ts` |
| 5.2.x / 5.3.x | Codificación de salida, XSS | ✅ | React; HTML de artículos saneado en el servidor (lista blanca); plantillas con variables en lista blanca y escapadas; CSP | `templates.test.ts`, `sanitize.test.ts` |
| 5.3.x | Inyección de fórmulas en exportaciones | ✅ | Prefijo `'` en CSV/XLSX | `export.test.ts` |
| 5.1.x | Importación de archivos CSV | ✅ | Parser RFC 4180 propio, tamaño ≤ 900 KB y ≤ 5 000 filas, validación completa antes de escribir | `csv.test.ts`, `import.int.test.ts` |
| 5.3.4 | Inyección SQL | ✅ | Prisma parametrizado; ESLint prohíbe `$queryRawUnsafe` | lint |
| 6.2.x | Criptografía aprobada | ✅ | AES-256-GCM, SHA-256, Argon2id, CSPRNG | `crypto.test.ts` |
| 6.4.x | Gestión de llaves | ✅ | OCI Vault (HSM), rotación por id de llave | `crypto.test.ts` |
| 7.1.x | Sin datos sensibles en logs | ✅ | Redacción de pino; los errores no repiten valores | `platform.int.test.ts` |
| 7.2.x / 7.3.x | Registro de eventos de seguridad, integridad | ✅ | Bitácora con hash encadenado e inmutable en BD | `admin.int.test.ts` |
| 8.1.x | Datos sensibles fuera de caché | ✅ | `Cache-Control: no-store` en la API | `platform.int.test.ts` |
| 8.3.x | Datos personales: exportación / eliminación | ✅ | Tareas de privacidad (exportar, anonimizar, eliminar) auditadas; retención configurable; detector de datos sensibles | `jobs.int.test.ts`, `config-admin.int.test.ts` |
| 9.1.x / 9.2.x | TLS | 🟡 | Cloudflare (TLS 1.2+/HSTS); túnel cifrado; TLS hacia PostgreSQL sin verificación de certificado | *smoke* (HSTS) |
| 10.3.x | Integridad de despliegues | ✅ | cosign + *digests* + aprobación | `deployer.test.sh` |
| 12.x | Archivos | ✅ | Lista blanca + *magic bytes*, ClamAV antes de descargar, URL firmada de 60 s, nombres saneados, imágenes recodificadas | `sniff.test.ts`, `attachments.int.test.ts`, `jobs.int.test.ts` |
| 13.1.x | API: allow-list de hosts, CORS cerrado | ✅ | Host desconocido → 421; sin CORS | `platform.int.test.ts` |
| 13.2.x | API REST: tokens de API | ✅ | Hash, expiración obligatoria, *scopes*, revocación, solo host de agentes | `config-admin.int.test.ts` |
| 12.6.1 / 5.2.6 | SSRF | ✅ | Webhooks solo HTTPS a IPs públicas validadas; Teams solo a hosts de Microsoft; clientes de DevOps/OIDC sin redirecciones | `safe-fetch.test.ts`, `teams.test.ts` |
| 13.1.5 | Documentación de la API | ✅ | OpenAPI 3.1 generado de las rutas con permisos por operación, solo para personal | `openapi.int.test.ts` |
| 13.2.x | Webhooks entrantes autenticados | ✅ | CTI (HMAC + anti-repetición) y Azure DevOps (*Basic* con secreto, estado releído) | `attachments.int.test.ts`, `integrations.int.test.ts` |
| 13.5.x | WebSocket | ✅ | Autenticación con la sesión, Origin y Host, salas autorizadas, revalidación | `realtime.int.test.ts` |
| 14.2.x | Dependencias | 🟡 | *Lockfile* + `pnpm audit` + Trivy en CI | CI |
| 1.14.x / 14.1.x | Verificación dinámica (DAST) | ✅ | OWASP ZAP *baseline* contra el stack de producción en CI; reglas FAIL en `deploy/tests/zap-rules.tsv` | `prod-stack.smoke.sh` (`DAST=1`) |
| 14.3.x / 14.4.x | Encabezados de seguridad | ✅ | Helmet (API) + nginx (web) | `platform.int.test.ts`, *smoke* |
| 14.5.x | Validación del Host / proxy | ✅ | `resolveArea`, `trustProxy` acotado | `host-area.test.ts`, *smoke* |
