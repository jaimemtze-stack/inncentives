# Fase 2 — Conocimiento, integraciones y reportes: resumen para revisión

**Estado:** terminada; **pendiente de aprobación para iniciar la fase 3**.

## 1. Qué se entregó

| Área (prompt) | Entregable | Ubicación |
|---|---|---|
| 4.9 Base de conocimiento | Categorías anidadas por módulo de Inncentives (14 creadas), respuestas en es-MX y en, visibilidad cliente/interna, borrador/publicada/archivada, publicación programada, historial de versiones inmutable, búsqueda de texto completo, sugerencias al crear un ticket en el portal e inserción desde el editor del agente; solo para usuarios autenticados | `apps/api/src/kb`, `apps/web/src/pages/Kb.tsx`, ADR-0015 |
| 4.7 Reportes y tablero | Creados/cerrados por día, primera respuesta y solución (promedio, mediana, p90), cumplimiento de SLA, reaperturas, carga por agente y grupo, **horas por organización contra su plan**, módulos y categorías frecuentes; exportación CSV y XLSX protegida contra inyección de fórmulas y auditada | `apps/api/src/reports`, `apps/web/src/pages/Reports.tsx`, ADR-0016 |
| 4.10 Azure DevOps | Crear o vincular *work items* desde el ticket, sincronización cada 15 min y por *service hook* autenticado, nota interna al cambiar de estado | `apps/api/src/integrations/devops.*`, ADR-0017 |
| 4.8 / 4.10 Teams | Canales por grupo y evento vía *Workflows*, URL cifrada y de solo escritura, tarjetas solo con metadatos | `apps/api/src/integrations/teams.ts`, ADR-0017 |
| Webhooks salientes | Registro de entregas (estado, error, duración) para webhooks y Teams, visible en Configuración | `apps/api/src/jobs/webhook-caller.service.ts`, `ConfigAdmin.tsx` |
| SSO OIDC | Proveedores configurables por área (Entra ID para agentes; Identity Server de Inncentives opcional para clientes), PKCE, sin aprovisionamiento: vinculación explícita por `issuer`+`sub` con reautenticación | `apps/api/src/auth/sso.*`, ADR-0018 |
| WebAuthn / passkeys | Segundo factor adicional o alternativo al TOTP, en el portal y en agentes | `apps/api/src/auth/webauthn.*`, `apps/web/src/components/Passkeys.tsx` |
| DAST en CI | OWASP ZAP *baseline* sobre el stack de producción (ambos hosts) dentro de la prueba *smoke*; reglas FAIL versionadas; reportes como artefacto | `deploy/tests/prod-stack.smoke.sh`, `deploy/tests/zap-rules.tsv`, `.github/workflows/mesa-soporte-ci.yml` |
| Importación CSV | Organizaciones e invitaciones de usuarios, con validación previa (*dry run*) y reporte de errores por fila; todo o nada | `apps/api/src/admin/import.service.ts`, `apps/web/src/pages/Admin.tsx` |
| Búsqueda global | Tickets + base de conocimiento + personas + organizaciones, con filtros `state:`, `tag:`, `owner:me`, `org:"…"`, `group:"…"`, `#número`; vista **Mis menciones** | `apps/api/src/search`, `apps/api/src/overviews` |
| API | Descripción **OpenAPI 3.1** generada de las rutas (`GET /api/v1/openapi.json`), con permisos y reautenticación por operación | `apps/api/src/openapi` |
| Preparación fase 3 | Interfaz `InncentivesClient` (ambientes, ejecuciones con error, Bitácora) con *mock* determinista | `apps/api/src/integrations/inncentives` |
| Correo del sistema | Transporte **Microsoft Graph** en el worker (pendiente 7 de la fase 1); SMTP sigue disponible | `apps/worker/src/graph.ts` |
| Despliegue y docs | Secretos nuevos (`azure_devops_pat`, `azure_devops_hook_secret`, `sso_entra_client_secret`), guía de despliegue (§5.4 y §9 ter), manuales, ADR-0015 a 0018, modelo de amenazas (#35–45) y matriz ASVS | `deploy/`, `infra/scripts/bootstrap-secrets.sh`, `docs/` |

## 2. Cómo se validó (ejecutado en este entorno)

| Verificación | Resultado |
|---|---|
| ESLint, Prettier, `tsc` (5 paquetes) | ✅ sin errores |
| Pruebas unitarias | ✅ 100 (shared 9, api 83, worker 5, web 3); nuevas: exportación segura, CSV, Teams, *mock* de Inncentives, transporte Graph, marcador `unused` de secretos |
| Integración (PostgreSQL + Redis + S3 + GreenMail reales) | ✅ 90 en 18 archivos; nuevas: base de conocimiento por audiencia, reportes y exportación auditada, DevOps (creación, vínculo, sincronización, *hook* con secreto), Teams (URL cifrada, tarjeta sin contenido, entregas), SSO contra un IdP local con `jose` (sin vinculación no entra, CSRF, `nonce`, `aud`, `state` repetido, host equivocado, MFA del IdP), importación CSV, búsqueda global, OpenAPI |
| E2E en Chromium (Playwright) | ✅ 5: los 4 anteriores (el de tickets ahora usa la búsqueda con `org:"ACME"`) + passkey registrada y usada como segundo factor con autenticador virtual |
| `prod-stack.smoke.sh` con `DAST=1` (amd64) | ✅ hardening, aislamiento y privilegios mínimos sin cambios; ZAP *baseline*: 0 hallazgos FAIL en ambos hosts. Avisos: CSP `img-src https:` (riesgo aceptado de la fase 1), comentarios en *bundles* minificados (informativo) |
| Trivy imágenes | ✅ api, worker y migrador: 0 HIGH/CRITICAL corregibles. Web: sigue el HIGH de `libexpat` porque aquí la imagen se construyó **sin** el `apk upgrade` (el CDN de Alpine está bloqueado en este entorno; ver §5) |
| `pnpm audit --prod` | ✅ sin vulnerabilidades conocidas |
| Semgrep (reglas comunitarias, sin conexión) | ✅ 0 ERROR; avisos nuevos revisados (HTML del *work item* y XML del XLSX escapados) |
| gitleaks, actionlint, shellcheck | ✅ |

## 3. Problemas reales encontrados por las pruebas y corregidos

1. La columna generada de búsqueda de la base de conocimiento fallaba porque `array_to_string` no es `IMMUTABLE`; se envolvió en una función inmutable con `coalesce`.
2. Crear un canal de Teams devolvía 500 (el campo `url` llegaba a Prisma); ahora se cifra a `urlEnc` con el id real como AAD.
3. El *lockfile* no se había incluido con las dependencias nuevas (`@simplewebauthn/server`, `jose`) en el commit de SSO/WebAuthn: el CI habría fallado en `--frozen-lockfile`; se corrigió en el commit siguiente.
4. Una prueba de la fase 1 dependía del orden de la vista "Sin asignar" en la base compartida; ahora pagina.
5. (En revisión) Los secretos de integraciones aún no configuradas se guardan con el valor `unused`, que se habría enviado como credencial real; API y worker ahora lo tratan como ausente.
6. Detalles de UI detectados por E2E: botón "Enviar" ambiguo con "Reenviar", mensaje de acción masiva desmontado, traducción faltante.

## 4. Decisiones tomadas sin consulta

- **SSO sin aprovisionamiento ni vinculación por correo** (ADR-0018). Por defecto el MFA propio se sigue pidiendo aunque el IdP haya hecho MFA (`trustIdpMfa: false`).
- **Teams por *Workflows*** (webhook entrante) en lugar de un bot: sin registro en Azure Bot Service.
- **XLSX generado sin librería** (OOXML mínimo) para no sumar dependencias con historial de vulnerabilidades.
- **Reportes en línea** sobre PostgreSQL, sin almacén analítico (ADR-0016).
- **OpenAPI generado de los metadatos** de Nest y Zod: describe rutas, parámetros, cuerpos y permisos; las respuestas no están tipadas en el documento todavía. Solo personal.
- **DAST dentro del *smoke*** de producción (stack real con nginx, CSP y cookies), no contra el servidor de desarrollo; *baseline* sin autenticación.
- **Correo del sistema por Graph opcional** (`MAIL_TRANSPORT=graph`): el valor por defecto sigue siendo SMTP para no romper una instalación existente.
- **Importación de usuarios = invitaciones** (nunca cuentas con contraseña), todo o nada.

## 5. Riesgos y pendientes

| # | Tema | Acción requerida | Quién |
|---|---|---|---|
| 1 | **CVE-2026-77214 (libexpat)** en la imagen base de nginx: el `apk upgrade` del `Dockerfile` sigue sin poder verificarse aquí | Confirmar en el primer run de CI que la imagen web queda sin HIGH | Neitek / CI |
| 2 | Entra ID, Azure DevOps, Teams y Graph `sendMail` probados con servidores simulados (IdP local, cliente DevOps en memoria, llamador simulado), no contra los servicios reales | Configurar según `despliegue.md` §5.4 y §9 ter y hacer las pruebas indicadas | Neitek |
| 3 | El Identity Server de Inncentives para clientes no se configuró (opcional); el mecanismo es el mismo que Entra | Dar de alta el cliente OIDC cuando se decida | Neitek |
| 4 | La base de conocimiento está vacía (solo categorías) | Redactar las primeras respuestas | Soporte Neitek |
| 5 | ZAP *baseline* es pasivo y sin sesión | Prueba de penetración autenticada antes de abrir el portal a clientes | Neitek |
| 6 | La API de Inncentives no existe: solo interfaz y *mock* | Definir la API (fase 3) | Inncentives |
| 7 | Pendientes abiertos de fases anteriores (retención, niveles de SLA por cliente, proveedor de telefonía, ejecución real en Ampere, buzón de seguridad) | Ver `fase-0.md` §5 y `fase-1.md` §5 | Neitek |

## 6. Cómo revisarlo rápido

```bash
cd mesa-soporte
docker compose up -d postgres redis s3 mailpit greenmail
pnpm install && pnpm --filter @mesa/shared build && pnpm db:migrate && pnpm db:seed
pnpm --filter @mesa/api dev & pnpm --filter @mesa/web dev
# Agentes: http://agentes.soporte.localhost:5173 → Base de conocimiento, Reportes, Administración → Importar desde CSV
# Búsqueda: owner:me org:"ACME" state:open
# API: GET /api/v1/openapi.json (sesión de agente)
sudo DAST=1 deploy/tests/prod-stack.smoke.sh   # requiere las imágenes locales (ver CI)
```
