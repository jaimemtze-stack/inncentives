# Modelo de amenazas (STRIDE) — versión inicial (fase 0)

> Se revisa al final de cada fase. Última revisión: 2026-10-15 (inicio de fase 0).

## 1. Alcance y activos

| Activo | Sensibilidad |
|---|---|
| Contenido de tickets y artículos (incluye notas internas) | Alta: puede contener datos personales y de nómina |
| Adjuntos (Excel con RFC, CURP, NSS, CLABE, sueldos) | Muy alta |
| Credenciales, semillas TOTP, sesiones, tokens de API | Muy alta |
| Datos de usuarios (correo, teléfono) | Media |
| Configuración de SLAs, triggers, integraciones (secretos de Azure DevOps, Teams, Graph) | Alta |
| AuditLog | Alta (integridad) |

## 2. Actores

- **Cliente administrador** (usuario de una empresa cliente) — autenticado, de confianza limitada.
- **Agente** de Neitek — autenticado, MFA obligatorio, acceso por grupos.
- **Administrador** de la mesa — máximo privilegio.
- **Remitente de correo externo** — no autenticado.
- **Proveedor CTI / servicios externos** — autenticados por HMAC.
- **Atacante externo** — internet.
- **Infraestructura** — Cloudflare, Azure, Microsoft 365.

## 3. Diagrama de flujo de datos (nivel 0)

```
 Internet ──► Cloudflare (WAF/TLS/Access) ──Tunnel──► VM
                                                     ├─ web (estático)
                                                     ├─ api ──► PostgreSQL (privado)
                                                     │     ├──► Redis (sesiones, colas)
                                                     │     └──► Blob/S3 (adjuntos, privado)
                                                     ├─ worker ──► Microsoft Graph (correo)
                                                     │        ├──► ClamAV
                                                     │        └──► Webhooks / Teams / Azure DevOps
                                                     └─ redis, clamav
```

Fronteras de confianza: (1) Internet ↔ Cloudflare, (2) Cloudflare ↔ VM, (3) API ↔ almacenamiento de datos, (4) worker ↔ servicios externos, (5) cliente ↔ agente (dentro de la app), (6) organización A ↔ organización B.

## 4. Amenazas y mitigaciones

| ID | STRIDE | Amenaza | Mitigación | Estado |
|---|---|---|---|---|
| T01 | S | Robo de credenciales por *credential stuffing* | Argon2id, HIBP, rate limiting por cuenta e IP, bloqueo progresivo, MFA obligatorio para agentes/admins | Fase 0 |
| T02 | S | Suplantación de un cliente por correo (remitente falsificado) | SPF/DKIM/DMARC vía `Authentication-Results`; grupo "Por verificar"; sin auto-respuestas con contenido | Fase 1 |
| T03 | S | Secuestro de sesión | Cookie `__Host-`, HttpOnly, Secure, SameSite; ID opaco hasheado en Redis; rotación; expiración | Fase 0 |
| T04 | S | Webhook CTI falsificado | HMAC-SHA256 + marca de tiempo + rechazo de repeticiones | Fase 1 |
| T05 | T | Alteración del AuditLog | Append-only (trigger de BD que rechaza UPDATE/DELETE), cadena de hash verificable | Fase 0 |
| T06 | T | CSRF en acciones de agente | *Double submit* firmado ligado a sesión, SameSite | Fase 0 |
| T07 | T | Inyección SQL | Prisma parametrizado; prohibido `$queryRawUnsafe` (Semgrep) | Fase 0 |
| T08 | T | XSS almacenado por correo HTML o editor | Sanitización en servidor con lista blanca; CSP sin `unsafe-inline`; bloqueo de imágenes remotas | Fase 0 (CSP) / 1 (sanitización) |
| T09 | T | Inyección de plantillas en macros/firmas | Motor de sustitución con lista blanca, sin evaluación de código | Fase 0 |
| T10 | T | Inyección de cabeceras de correo | Validación de CR/LF en asunto y direcciones | Fase 1 |
| T11 | R | Agente niega haber visto o redactado datos | AuditLog de vistas sensibles, descargas, redacciones y "ver como cliente" | Fase 0/1 |
| T12 | I | **IDOR / acceso entre organizaciones** | Guard global *deny-by-default*, `PolicyService` único en capa de consulta, matriz de pruebas | Fase 0 |
| T13 | I | Cliente ve notas internas | DTOs por rol en servidor; pruebas E2E y de API | Fase 1 |
| T14 | I | Fuga por canal lateral (búsqueda, tiempo real, exportación, contadores de vistas) | Todos usan el filtro de `PolicyService`; rooms de Socket.IO autorizados | Fase 1 |
| T15 | I | **Datos de nómina en adjuntos** | Detector de datos sensibles, aviso al cliente, redacción, retención, URL firmada ≤ 5 min | Fase 0 (detector) / 1 |
| T16 | I | Secretos en logs o repositorio | Redacción en logger, gitleaks en CI, secretos por proveedor | Fase 0 |
| T17 | I | Enumeración de cuentas | Respuestas idénticas en login, recuperación e invitación | Fase 0 |
| T18 | I | SSRF desde webhooks/integraciones | Solo HTTPS, validación de IP resuelta contra rangos privados/metadatos, sin redirecciones | Fase 1/2 |
| T19 | I | Notificaciones a Teams con contenido del cliente | Solo metadatos (número, título, organización, prioridad, evento) | Fase 2 |
| T20 | I | Envío de datos personales a IA | IA deshabilitada; en fase 3 redacción previa y sin adjuntos | Fase 3 |
| T21 | D | Bucles de correo (auto-respuestas) | Detección de `Auto-Submitted`, `Precedence`, DSN; límite por remitente/hora | Fase 1 |
| T22 | D | Bucles de triggers | Límite de ejecuciones encadenadas y aviso de riesgo | Fase 1 |
| T23 | D | DoS por adjuntos grandes o zip-bombs | Límites de tamaño, ClamAV con límites de escaneo, cuerpo máximo | Fase 0/1 |
| T24 | D | DoS volumétrico | Cloudflare WAF/DDoS, rate limiting en API | Fase 0 |
| T25 | E | Escalada cliente → agente | Roles verificados en servidor, separación de hosts, Cloudflare Access en host de agentes | Fase 0 |
| T26 | E | Malware en adjuntos que infecta a agentes | ClamAV antes de descarga, cuarentena, `Content-Disposition: attachment` | Fase 1 |
| T27 | E | Abuso de "ver como cliente" | Solo admins, solo lectura, motivo, 15 min, banner, auditoría | Fase 1 |
| T28 | E | Contenedor comprometido | Imágenes no-root, FS de solo lectura, sin capacidades, Trivy | Fase 0 |

## 5. Riesgos residuales

- La VM única es punto único de falla (aceptado para el volumen; RTO 8 h).
- Si el proveedor de correo no entrega `Authentication-Results` confiable, todo correo entrante iría a "Por verificar".
- Un agente con acceso legítimo puede exfiltrar datos; se mitiga con auditoría y mínimo privilegio por grupo, no se elimina.
