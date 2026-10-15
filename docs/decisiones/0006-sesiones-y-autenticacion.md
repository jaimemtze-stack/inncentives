# ADR-0006: Sesiones de servidor, Argon2id y TOTP

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Decisión
- **Contraseñas:** Argon2id (`m=19456 KiB, t=2, p=1`, mínimo recomendado por OWASP), longitud mínima 12, sin reglas de composición, verificación contra Have I Been Pwned por *k-anonymity* (`HIBP_ENABLED`, falla abierta si no hay red y lo registra).
- **Sesiones** opacas en Redis (ID aleatorio de 256 bits; en Redis se guarda solo el hash SHA-256 del ID). Cookie `__Host-sid` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`). Nombres distintos por host para portal y agentes. Sin JWT en `localStorage`.
- Rotación del ID al iniciar sesión, al completar MFA y al reautenticarse. Inactividad 30 min, absoluta 12 h (configurables).
- **CSRF:** *double submit* firmado con HMAC ligado a la sesión (`__Host-csrf` + cabecera `X-CSRF-Token`).
- **MFA:** TOTP (RFC 6238, SHA-1, 6 dígitos, ventana ±1) con 10 códigos de recuperación (hash Argon2id). Semilla cifrada con AES-256-GCM. Obligatorio para `admin` y `agent`; para clientes según la organización (por defecto recomendado). WebAuthn en fase 2.
- **Bloqueo progresivo:** contador por cuenta e IP en Redis; tras 5 fallos, retraso exponencial; tras 10, bloqueo temporal de 15 min. Respuestas idénticas exista o no la cuenta.
- **Tokens de un solo uso** (invitación, recuperación): 32 bytes aleatorios, se guarda SHA-256, caducidad 72 h (invitación) y 30 min (recuperación).
- **Reautenticación:** acciones sensibles exigen `reauthAt` en la sesión con antigüedad ≤ 5 min.

## Consecuencias
- Revocar sesiones es inmediato (borrado en Redis).
- Redis se vuelve dependencia crítica para autenticación (incluido en `/ready`).
