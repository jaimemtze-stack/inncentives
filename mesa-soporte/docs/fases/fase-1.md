# Fase 1 — MVP: resumen para revisión

**Estado:** terminada y aprobada (la fase 2 se inició con aprobación).

## 1. Qué se entregó

| Área (prompt) | Entregable | Ubicación |
|---|---|---|
| 4.1 Tickets | Alta desde correo, teléfono, portal y agente (en nombre de un cliente); hilo de artículos; barra lateral (estado, prioridad, grupo, propietario, campos, etiquetas, enlaces, checklist, tiempo, otros tickets del cliente, historial); responder, responder a todos, reenviar, citar, nota interna; fusionar, dividir, vincular; @menciones con notificación; seguir/dejar de seguir; colisión en tiempo real (quién ve y quién escribe, aviso si alguien guardó mientras redactabas); borrador local y compartido; macros, módulos de texto `::atajo`, plantillas y firmas con variables en lista blanca; acciones masivas; atajos de teclado; contabilidad de tiempo con tipo de actividad (opcionalmente obligatoria) y resumen mensual por organización contra su plan | `apps/api/src/tickets`, `apps/web/src/pages/Ticket*.tsx` |
| 4.2 Correo | Adaptadores Microsoft Graph e IMAP/SMTP; hilos por `In-Reply-To`/`References` y `[Ticket#…]`; filtros postmaster; antibucles y rebotes; identificación del remitente con `Authentication-Results` de confianza y grupo **Por verificar**; HTML saneado, imágenes remotas bloqueadas, `cid:` como adjuntos; cola de salida con estado de entrega | `apps/api/src/channels/email`, ADR-0012 |
| 4.3 Teléfono | Registro manual de llamadas, búsqueda por número (E.164, prefijo "52 1" heredado), webhook CTI genérico (`newCall`/`answer`/`hangup`) con HMAC + anti-repetición, interfaz `TelephonyProvider`, aviso de llamada entrante en tiempo real | `apps/api/src/channels/phone`, `apps/web/src/pages/Phone.tsx` |
| 4.4 Portal | Mis tickets / cerrados / de la organización (permiso por usuario y organizaciones secundarias), alta con campos visibles y Core Workflows, respuesta, adjuntos, cierre según configuración, aviso de privacidad y alerta de datos sensibles antes de enviar; DTOs específicos sin datos internos | `apps/web`, `apps/api/src/tickets/dto.ts` |
| Organizaciones y permisos | Planes de soporte, grupos con niveles de acceso (`read`, `create`, `change`, `overview`, `full`), roles personalizados que amplían permisos del personal, permisos `tickets.agent`, `tickets.customer`, `admin.config`, `admin.data_privacy`, `admin.view_as_customer` | `packages/shared/src/permissions.ts`, `apps/api/src/policy` |
| 4.5 / 4.6 SLA y automatización | Calendario laboral de México (lun–vie 9:00–18:30, feriados de la LFT incluido el 1 de octubre sexenal) con días propios; SLAs por condición con primera respuesta, actualización y solución, pausa en pendientes, aviso al 80 % y vencido (notifica propietario/grupo y admins); triggers, planificadores (con horario hábil), Core Workflows aplicados también en el servidor, asignación automática por grupo, ausencias con sustituto | `apps/api/src/sla`, `apps/api/src/automation`, `apps/api/src/jobs`, ADR-0011 |
| 4.7 Vistas y búsqueda | Vistas por rol con contador, orden y paginación; búsqueda de texto completo (PostgreSQL, español + inglés, sin acentos) en títulos y artículos, con filtros `state:`, `tag:` y `#número`; los clientes nunca encuentran notas internas | `apps/api/src/overviews` |
| 4.8 Notificaciones | En la aplicación (campana, tiempo real) y por correo según preferencias del usuario | `apps/api/src/notifications`, `apps/web/src/components/Notifications.tsx` |
| 4.11 Administración | CRUD validado y auditado de grupos, prioridades, roles, planes, firmas, calendarios, SLAs, triggers, planificadores, Core Workflows, macros, módulos de texto, plantillas, vistas, campos personalizados, tipos de actividad, canales de correo, filtros postmaster, webhooks y retención; ajustes generales; accesos de agentes; tokens de API; privacidad; ver como cliente | `apps/api/src/config-admin`, `apps/web/src/pages/ConfigAdmin.tsx` |
| 5 Seguridad | Adjuntos (lista blanca + *magic bytes*, ClamAV, URL firmada de 60 s, imágenes recodificadas), detector de datos sensibles (RFC, CURP, NSS, CLABE, tarjetas, columnas de sueldo en CSV/XLSX/DOCX), redacción y borrado auditados, retención (desactivada), tareas ARCO, webhooks con protección SSRF, tokens de API, tiempo real autorizado, "ver como cliente" | ADR-0013, ADR-0014 |
| Proceso `jobs` | Correo entrante/saliente, escaneo de adjuntos, SLAs, pendientes, planificadores, privacidad, retención y limpieza (BullMQ) | `apps/api/src/jobs`, `deploy/docker-compose.prod.yml` |
| Documentación | Guía de despliegue actualizada (Graph con RBAC for Applications, secretos nuevos, pasos posteriores), manual de administrador, manual de agente, ADR-0011 a ADR-0014, modelo de amenazas y matriz ASVS | `docs/` |

## 2. Cómo se validó (ejecutado en este entorno)

| Verificación | Resultado |
|---|---|
| ESLint, Prettier, `tsc` (5 paquetes) | ✅ sin errores |
| Pruebas unitarias | ✅ 90 (shared 9, api 75, worker 3, web 3): calendario y feriados, SLA, motor de condiciones, sanitización, plantillas, detector de datos sensibles y lector/escritor ZIP, *magic bytes*, reglas de correo (Authentication-Results, bucles, hilos, filtros), firmas HMAC, teléfonos, SSRF |
| Integración (PostgreSQL + Redis + S3 + GreenMail reales) | ✅ 76: acceso por grupo, IDOR entre organizaciones, notas internas, ciclo de vida y SLA, fusión, enlaces, checklist, tiempo, triggers (una vez por cadena), Core Workflows en el servidor, macros, acciones masivas, vistas, búsqueda, notificaciones, tiempo real (salas, origen, presencia), adjuntos (tipos, escaneo, auditoría, redacción), CTI firmado, correo de extremo a extremo por IMAP/SMTP, remitentes no verificados, rebotes, filtros, jobs (antivirus simulado, SLA, pendientes, planificadores, retención, ARCO, webhooks firmados), administración y tokens; la prueba de rutas confirma que **todas** declaran permisos |
| E2E en Chromium (Playwright) | ✅ 4: los 3 de la fase 0 + agente registra llamada → nota interna invisible para el cliente → cliente responde en el portal → el agente lo ve sin recargar → acción masiva |
| `prod-stack.smoke.sh` (amd64) | ✅ con el servicio `jobs`, WebSocket a través de nginx, hardening, aislamiento de redes y privilegios mínimos de BD |
| Trivy imágenes | ✅ api, worker y migrador: 0 HIGH/CRITICAL corregibles. Web: 1 HIGH en `libexpat` de la imagen base de nginx (ver §5) |
| `pnpm audit --prod` | ✅ sin vulnerabilidades conocidas |
| Semgrep (reglas comunitarias, sin conexión) | ✅ 0 ERROR; advertencias de seguridad revisadas (HTML escapado/saneado) y anotadas |
| gitleaks (con la configuración del repo) | ✅ sin fugas |
| Terraform `validate`, actionlint, shellcheck | ✅ |

## 3. Problemas reales encontrados por las pruebas y corregidos

1. El orden de las vistas fallaba con `nulls: 'last'` en columnas no nulas; ahora solo se aplica a columnas que admiten nulos.
2. Las pruebas de integración no tenían almacenamiento S3 configurado; ahora crean su bucket en SeaweedFS.
3. El *parser* JSON propio para el cuerpo crudo del webhook chocaba con el de NestJS; se usa `rawBody` de Nest.
4. `BlockList` de Node trata `::ffff:0:0/96` como si incluyera todo IPv4; las direcciones mapeadas se evalúan por su IPv4.
5. El `Dockerfile` solo pasaba la CA del proxy al primer comando de compilación (Prisma no descargaba motores detrás de un proxy con inspección TLS).
6. Varios detalles de la UI detectados por E2E (botón "Enviar" ambiguo, mensaje de acción masiva que desaparecía).

## 4. Decisiones tomadas sin consulta

- **Reglas como datos** con catálogo cerrado de campos y operadores (ADR-0011).
- **Sin `Authentication-Results` de confianza, todo el correo va a "Por verificar"** (seguro por defecto).
- **Proceso `jobs` con la imagen de la API** en lugar de una imagen nueva (menos superficie y una sola base de código).
- **Editor de reglas en JSON** validado por el servidor en la administración (los formularios visuales de condiciones quedan para una mejora posterior).
- **CSP `img-src https:`** para permitir "Mostrar imágenes remotas" a petición del agente.
- **Webhook CTI en el host del portal** (los proveedores no pueden pasar Cloudflare Access).

## 5. Riesgos y pendientes

| # | Tema | Acción requerida | Quién |
|---|---|---|---|
| 1 | **CVE-2026-77214 (libexpat) en la imagen base de nginx:** aún no hay imagen corregida; se agregó `apk upgrade` al `Dockerfile`, que **no pudo verificarse aquí** porque el proxy de este entorno bloquea el CDN de Alpine | Confirmar en el primer run de CI que la imagen web queda sin HIGH | Neitek / CI |
| 2 | Antivirus probado con respuestas simuladas de clamd; el contenedor ClamAV real se valida en el despliegue (paso 9 bis, archivo EICAR) | Verificar en OCI | Infra Neitek |
| 3 | El adaptador de **Microsoft Graph** está probado con un cliente HTTP simulado en el código, no contra un tenant real; IMAP/SMTP sí se probó de extremo a extremo con GreenMail | Configurar el buzón `soporte@` y probar (despliegue §5) | Neitek |
| 4 | Plazos de **retención** sin definir (pendiente 9): el mecanismo existe y está desactivado | Definir plazos | Neitek |
| 5 | Niveles de SLA por cliente aún no entregados: se usan los tiempos por defecto | Enviar los niveles para configurarlos | Neitek |
| 6 | Proveedor de telefonía sin definir: solo registro manual y webhook genérico | Elegir proveedor (fase 3) | Neitek |
| 7 | El correo del sistema (invitaciones, notificaciones) sigue por SMTP AUTH | Migrarlo a Graph en la fase 2 | Fase 2 |
| 8 | Los pendientes de la fase 0 (ejecución real en Ampere, primer run de CI, buzón de seguridad) siguen abiertos | Ver `fase-0.md` §5 | Neitek |

## 6. Cómo revisarlo rápido

```bash
cd mesa-soporte
docker compose up -d postgres redis s3 mailpit greenmail
pnpm install && pnpm --filter @mesa/shared build && pnpm db:migrate && pnpm db:seed
pnpm --filter @mesa/api dev & pnpm --filter @mesa/web dev
node --env-file=.env apps/api/dist/jobs-main.js &   # correo, SLAs, escaneos
# Agentes: http://agentes.soporte.localhost:5173 (agente@neitek.example)
# Portal:  http://soporte.localhost:5173 (cliente@acme.example)
```
