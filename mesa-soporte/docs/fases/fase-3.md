# Fase 3 — Canales adicionales e Inncentives: resumen para revisión

**Estado:** terminada; **pendiente de revisión humana**. Es la última fase del plan del prompt (sección 6).

## 1. Qué se entregó

| Área (prompt) | Entregable | Ubicación |
|---|---|---|
| 4.10 API de Inncentives | Contrato propuesto, cliente HTTP endurecido y *mock*; clave de tenant por organización; barra lateral del ticket con ambientes, versión, procesos con error y Bitácora reciente (caché 60 s, tolerante a fallas) | `apps/api/src/integrations/inncentives`, `docs/integraciones/api-inncentives.md`, ADR-0019 |
| 4.10 Widget "Reportar un problema" | `widget.js` para el Sistema administrativo; contexto firmado por Inncentives (JWT HS256, ≤ 15 min, un uso) verificado contra la organización del cliente; ticket con ambiente, módulo, versión, nota interna con URL y hora; captura pegada o adjunta | `apps/web/public/widget.js`, `apps/web/src/pages/Report.tsx`, `docs/integraciones/widget.md` |
| 4.3 Telefonía con proveedor real | Conector **Twilio Voice** (`TelephonyProvider`) con firma `X-Twilio-Signature`, bitácora de llamadas y aviso al agente | `apps/api/src/channels/twilio`, ADR-0020 |
| 4.12 WhatsApp Business y SMS | Meta Cloud API y Twilio SMS: entrada firmada, deduplicación, adjuntos de WhatsApp al antivirus, desconocidos a *Por verificar*, respuestas por cola con reintentos, ventana de 24 h, acuses de entrega y lectura | `apps/api/src/channels/messaging`, ADR-0020 |
| 4.12 Chat en vivo | Portal y widget; disponibilidad de agentes por latido, cola, aceptación atómica, chat como ticket de canal `chat`, cierre por inactividad | `apps/api/src/chat`, `apps/web/src/pages/Chat.tsx`, ADR-0021 |
| 4.12 / 5.12 IA | Resumen, sugerencia de respuesta con la base de conocimiento, clasificación y asistente de redacción, **desactivada por defecto** (global y por organización); redacción de datos personales, sin adjuntos, auditoría, límite por agente, solo sugerencias | `apps/api/src/ai`, `apps/web/src/components/AiPanel.tsx`, ADR-0022 |
| Despliegue y docs | 7 secretos nuevos, compose, *bootstrap*, *smoke* (widget.js, CSP sin iframe, hooks sin firma = 401), guía §5.5 y §9 quater, regla de Cloudflare para `/hooks/`, manuales, ADR-0019 a 0022, amenazas #46–55, ASVS | `deploy/`, `infra/scripts/bootstrap-secrets.sh`, `docs/` |

## 2. Cómo se validó (ejecutado en este entorno)

| Verificación | Resultado |
|---|---|
| ESLint, Prettier, `tsc` (5 paquetes) | ✅ sin errores |
| Pruebas unitarias | ✅ 110 (shared 9, api 93, worker 5, web 3); nuevas: firma de Twilio contra el vector oficial de su librería, parser de WhatsApp/SMS y firma de Meta, cliente HTTP de Inncentives, redacción para IA, forma exacta de la petición del SDK de Anthropic (modelo, esfuerzo, *fallback*, salida estructurada) y manejo de rechazos |
| Integración (PostgreSQL + Redis + S3 reales) | ✅ 106 en 23 archivos; nuevas: barra lateral y widget (firma, audiencia, otro cliente, URL no HTTPS, un solo uso), Twilio Voice, WhatsApp y SMS de extremo a extremo con proveedores simulados, chat (disponibilidad, cola, aceptación única, privacidad, cierre e inactividad), IA (apagada por defecto, redacción, permisos, auditoría, clasificación validada) |
| E2E en Chromium (Playwright) | ✅ 6: los anteriores + el chat en vivo entre agente y cliente en tiempo real, y el widget con contexto firmado que sobrevive al inicio de sesión |
| `prod-stack.smoke.sh` con `DAST=1` | ✅ con las comprobaciones nuevas; ZAP *baseline* sin hallazgos FAIL |
| Trivy, `pnpm audit`, Semgrep, gitleaks, shellcheck | ✅ api, worker y migrador sin HIGH/CRITICAL; web con el mismo HIGH de `libexpat` (ver §5); audit sin vulnerabilidades; Semgrep 0 ERROR; sin fugas |

## 3. Problemas reales encontrados y corregidos

1. Si una ruta declaraba otro tipo de contenido (TwiML, texto) y fallaba, el filtro de errores no podía serializar el JSON y respondía 500 en lugar de 401; ahora los errores siempre salen como JSON.
2. Dos pruebas de fases anteriores dependían de que la base compartida no tuviera tickets de otros archivos (reportes por grupo); ahora filtran por su organización.
3. El interruptor de disponibilidad del chat esperaba la respuesta del servidor antes de marcarse (Playwright lo detectó); ahora es optimista y se revierte si falla.
4. El E2E del widget fallaba si corría después del registro de passkey del cliente; se reordenó.

## 4. Decisiones tomadas sin consulta

- **Twilio** como proveedor de voz y SMS (pendiente 7 seguía abierto); otro proveedor es otro `TelephonyProvider`.
- **Widget en ventana nueva**, no en iframe (mantiene `frame-ancestors 'none'` y la cookie *first-party*).
- **Contexto del widget con secreto compartido HS256** (lo más simple para Inncentives); puede cambiarse a llaves asimétricas cuando exista su IdP.
- **Contrato de la API de Inncentives propuesto por nosotros**; modo `off` por defecto en producción.
- **Chat = ticket**; solo clientes autenticados; un chat que nadie atendió queda como ticket abierto.
- **IA implementada pero apagada** (el prompt la condiciona a aprobación): Claude Opus 5.5 por la API de Anthropic, esfuerzo medio, *fallback* del servidor ante rechazos.
- **WhatsApp fuera de la ventana de 24 h** no se envía (sin plantillas por ahora).

## 5. Riesgos y pendientes

| # | Tema | Acción requerida | Quién |
|---|---|---|---|
| 1 | La API de Inncentives no existe; la barra lateral funciona con el *mock* | Validar o ajustar el contrato y emitir el token del widget desde Inncentives | Inncentives |
| 2 | Twilio, Meta y Anthropic probados con servidores simulados | Configurar cuentas reales y hacer las pruebas de §9 quater | Neitek |
| 3 | **IA desactivada** hasta aprobación (contrato de retención cero, alcance, organizaciones) | Decidir; si se aprueba, habilitar por organización | Neitek |
| 4 | Plantillas de WhatsApp (mensajes fuera de 24 h) y MMS no implementados | Definir si se necesitan | Neitek |
| 5 | CVE-2026-77214 (libexpat) en la imagen web: el `apk upgrade` sigue sin verificarse aquí | Confirmar en el primer run de CI | Neitek / CI |
| 6 | Pendientes de fases anteriores (prueba de penetración autenticada, retención, SLAs por cliente, primer run de CI, Ampere real) | Ver `fase-0.md` a `fase-2.md` §5 | Neitek |

## 6. Cómo revisarlo rápido

```bash
cd mesa-soporte
docker compose up -d postgres redis s3 mailpit greenmail
pnpm install && pnpm --filter @mesa/shared build && pnpm db:migrate && pnpm db:seed
pnpm --filter @mesa/api dev & pnpm --filter @mesa/web dev
# Agentes: ticket de ACME → panel "Inncentives" (datos simulados); página "Chat" → Disponible
# Portal (cliente@acme.example): "Chat"; /reportar con un token firmado (ver docs/integraciones/widget.md)
```
