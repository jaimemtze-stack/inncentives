# Prompt: Mesa de soporte de Inncentives (inspirada en Zammad)

> **Uso:** copia este documento completo como instrucción inicial para Claude Code en un repositorio nuevo y vacío. Está escrito para que Claude Code trabaje de forma autónoma, fase por fase.

---

## 0. Rol y forma de trabajo

Actúa como un equipo senior de ingeniería de software (arquitecto, desarrollador full-stack, ingeniero de seguridad y QA). Vas a construir de forma **autónoma** una aplicación web de mesa de soporte (help desk) para **Inncentives**, una plataforma SaaS de compensación variable (ICM) que maneja datos de nómina y datos personales. La referencia funcional es **Zammad**. No copies su código; reproduce su comportamiento y su modelo conceptual adaptados a este contexto.

Reglas de trabajo:

1. **Trabaja por fases** (sección 6). No empieces una fase hasta que la anterior cumpla su *Definición de terminado* (sección 9).
2. **No te bloquees por decisiones pendientes** (sección 10). Implementa la opción por defecto indicada, déjala configurable y regístrala en `docs/decisiones/` como ADR (Architecture Decision Record).
3. **Mantén `docs/PROGRESO.md`** con lo terminado, lo que está en curso, lo siguiente y los riesgos. Actualízalo al cerrar cada bloque de trabajo.
4. **Commits pequeños y descriptivos** (Conventional Commits). Cada commit compila y pasa las pruebas.
5. **La seguridad no es una fase.** Los requisitos de la sección 5 aplican desde el primer commit, y cada endpoint nuevo lleva sus pruebas de autorización.
6. **No inventes requisitos de negocio.** Si algo no está aquí ni tiene un valor por defecto, elige la opción más simple y segura, hazla configurable y documéntala.
7. **Idiomas:** el código, los identificadores y los comentarios van en inglés. La interfaz va en **español (México) e inglés**, con español por defecto. La documentación del proyecto va en español.
8. **Nunca apliques cambios a infraestructura real.** Escribes y validas la infraestructura como código (sección 2.1), pero no tienes credenciales de nube y no debes pedirlas. Una persona de Neitek ejecuta el aprovisionamiento siguiendo `docs/despliegue.md`.
9. **Al terminar una fase, detente** y deja en `docs/fases/fase-N.md` un resumen para revisión humana. No empieces la siguiente fase sin aprobación explícita.

---

## 1. Contexto del negocio

- **Producto soportado:** Inncentives, de Neitek. Tiene dos aplicaciones: el *Sistema administrativo* (configuración de planes, tablas dinámicas, procesos calendarizados, flujos, reportes y Centro de Comando para migrar entre Dev/QA/Prod) y el *Portal* (los beneficiarios consultan reportes y levantan aclaraciones).
- **Quién abre tickets:** **solo los usuarios administradores de cada empresa cliente de Inncentives.** Los beneficiarios **no** tienen acceso a la mesa de soporte; sus aclaraciones siguen en el Portal de Inncentives.
- **Quién atiende:** agentes de soporte de Neitek, organizados por niveles (N1/N2/N3; la definición exacta está pendiente) y grupos.
- **Clientes:** cada empresa cliente es una **organización** con su propio contrato de soporte y su **SLA distinto**.
- **Horario de atención:** lunes a viernes, de 9:00 a 18:30, zona horaria `America/Mexico_City`, con los días de descanso obligatorio de México (sección 4.6).
- **Herramienta actual:** ninguna. No hay datos que migrar.
- **Herramientas internas:** Azure DevOps (gestión de bugs y trabajo de desarrollo) y Microsoft Teams (comunicación).
- **Regulación:** datos personales de usuarios de clientes empresariales en México. Aplica la LFPDPPP (y la LGPDPPSO para clientes del sector público). Algunos clientes pueden estar sujetos a GDPR. Neitek está en proceso de certificación ISO 27001.
- **Riesgo particular:** los clientes podrían adjuntar archivos con **datos de nómina de sus empleados** (Excel con RFC, CURP, NSS, CLABE, sueldos). La aplicación debe tratarlo como un riesgo de primer orden (sección 5.7).

---

## 2. Stack tecnológico y despliegue

El criterio es **seguridad + bajo costo de operación + portabilidad**. Usa este stack salvo que encuentres un impedimento técnico concreto; si lo cambias, justifícalo con un ADR.

| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript (strict) en todo el proyecto | Un solo lenguaje y tipos compartidos entre cliente y servidor. |
| Monorepo | pnpm workspaces: `apps/api`, `apps/web`, `apps/worker`, `packages/shared` | Contratos y validaciones compartidos. |
| API | NestJS sobre Fastify | Módulos, guards y pipes que facilitan aplicar autorización de forma uniforme. |
| Validación | Zod (esquemas compartidos cliente/servidor) | Una sola fuente de verdad para la validación de entrada. |
| Base de datos | PostgreSQL 16 | Búsqueda de texto completo nativa (`tsvector`, diccionarios `spanish` y `english`), así que no hace falta Elasticsearch. |
| ORM y migraciones | Prisma | Migraciones versionadas y consultas parametrizadas. |
| Colas y tiempo real | Redis 7 + BullMQ; Socket.IO con adaptador Redis | Jobs de correo, SLAs, planificadores, escaneo de adjuntos; presencia y colisión. |
| Frontend | React 18 + Vite + TanStack Router/Query + Tailwind + shadcn/ui + i18next | SPA ligera; una sola app con áreas separadas para agentes, clientes y administración. |
| Editor | TipTap con sanitización en el servidor | Texto enriquecido seguro. |
| Archivos | Interfaz `StorageProvider` con dos adaptadores: **S3** (MinIO en local y pruebas) y **OCI Object Storage nativo** (SDK de OCI con *instance principals*, sin llaves) en producción | Producción sin credenciales de larga duración; local y CI sin depender de la nube. |
| Secretos | Interfaz `SecretsProvider`: la app **solo lee archivos** en `/run/secrets` (Docker secrets). En producción, un servicio del host (`secrets-sync`) los obtiene de **OCI Vault** con *instance principals* y los escribe en `tmpfs` | La app no depende del proveedor de secretos y nunca recibe secretos por variables de entorno. |
| Antimalware | ClamAV (contenedor `clamd`; usar una imagen con soporte `linux/arm64`, como `clamav/clamav-debian`, y verificarlo en la fase 0) | Escaneo de todos los adjuntos. |
| Correo | Microsoft Graph API sobre un buzón de Microsoft 365 (entrada y salida), con una interfaz de adaptadores para IMAP/SMTP | El buzón de soporte todavía no existe; aún así, el desarrollo y las pruebas no deben depender de él (usa Mailpit en local). |
| Pruebas | Vitest (unidad), Supertest (API), Playwright (E2E), Testcontainers (integración con Postgres/Redis) | — |
| Observabilidad | Logs JSON estructurados (pino), OpenTelemetry, endpoint `/health` y `/ready` | — |
| Empaquetado | Docker multi-stage con imágenes no-root y distroless/slim, **multi-arquitectura (`linux/amd64` y `linux/arm64`)**, firmadas con cosign y con SBOM; `docker-compose.yml` para local y `docker-compose.prod.yml` para el servidor | Producción corre en ARM (Ampere A1); los desarrolladores pueden estar en x86. |
| Infraestructura como código | Terraform con el provider `oci`; cloud-init para el servidor; scripts de operación en `deploy/` (Bash con `set -euo pipefail`, validados con shellcheck) | Reproducible: el servidor se puede reconstruir desde cero. |
| Respaldos | pgBackRest (PITR con WAL continuo) + volcado diario cifrado a un bucket inmutable | Restauración a un punto en el tiempo y protección contra ransomware. |

**Requisitos de la app derivados del despliegue:**

- Servir el **portal de clientes y el área de agentes/admin en hosts distintos** (configurables, por ejemplo `soporte.inncentives.com` y `agentes.soporte.inncentives.com`), con cookies separadas por host. Los endpoints de agentes y admin solo responden en su host.
- Los webhooks entrantes van bajo `/hooks/*` (el proxy de entrada los excluye de la autenticación de red y los protege con WAF y firma).
- Confiar en la IP del cliente solo desde la cabecera `CF-Connecting-IP` y solo si la petición llega por el túnel (configurable), para que el *rate limiting* y la auditoría usen la IP real.
- Todo debe funcionar en ARM64.

La aplicación sigue los principios *12-factor*: toda la configuración va por variables de entorno y los secretos se leen de un proveedor de secretos como archivos montados (Docker secrets; en producción vienen de OCI Vault), nunca de variables de entorno ni del repositorio.

### 2.1 Infraestructura de producción: Oracle Cloud (OCI), región México

Decisión tomada por Neitek: **OCI en la región Querétaro (`mx-queretaro-1`)**, o Monterrey si no hay capacidad, aprovechando los recursos *Always Free* para un costo de ~$5–15 USD/mes. La cuenta es de **pago por uso** (*Pay As You Go*) con presupuesto y alertas, para que Oracle no reclame recursos inactivos. Si Oracle retira el *Always Free*, la misma arquitectura cuesta ~$30–40 USD/mes, sin cambios de código.

Arquitectura:

```
 soporte.inncentives.com (clientes)        agentes.soporte.inncentives.com (Neitek)
              │                                          │
 ┌──────────────────────────────── Cloudflare ─────────────────────────────────┐
 │ DNS · TLS · WAF · DDoS · rate limiting · Access (Entra ID) para agentes y SSH │
 └───────────────────────────────────┬─────────────────────────────────────────┘
                                     │ Cloudflare Tunnel (conexión saliente)
 ┌──────────── OCI · mx-queretaro-1 · compartimento "soporte-prod" ─────────────┐
 │ VCN · subred PRIVADA (sin IP pública)                                         │
 │  NAT Gateway (salida a Internet) · Service Gateway (Object Storage y Vault)    │
 │  ┌──── VM.Standard.A1.Flex · 2 OCPU · 12 GB · Ubuntu 24.04 aarch64 ────────┐  │
 │  │ cloudflared · caddy · web · api · worker · redis · clamav · postgres    │  │
 │  │ pgbackrest · secrets-sync · deployer   (cloud-init + Docker Compose)    │  │
 │  │ Volumen de arranque 50 GB · volumen de bloque 100 GB para PostgreSQL     │  │
 │  └─────────────────────────────────────────────────────────────────────────┘  │
 │  Buckets: adjuntos (versionado) · respaldos-pitr (versionado)                 │
 │           respaldos-inmutables (retention rule, bloqueada por una persona)    │
 │  Vault (llave maestra en HSM + secretos) · Bastion · Cloud Guard ·            │
 │  Security Zone · Logging · Monitoring/Alarms · Notifications · Budgets        │
 └──────────────────────────────────────────────────────────────────────────────┘
```

Entregables de infraestructura en el repositorio (fase 0):

1. **`infra/terraform/`** (provider `oci`, versiones fijadas):
   - Compartimento, VCN, subred privada, NAT Gateway, Service Gateway, tablas de rutas y **NSG sin ninguna regla de entrada** salvo SSH desde la IP privada de OCI Bastion.
   - Instancia `VM.Standard.A1.Flex` (2 OCPU, 12 GB) dentro de los límites *Always Free*, con volumen de bloque separado para los datos de PostgreSQL, cifrado en tránsito del volumen y *Secure Boot* si la imagen lo admite.
   - **Vault** con una llave maestra en HSM, secretos vacíos (los valores los carga una persona, nunca Terraform) y los buckets cifrados con esa llave.
   - Buckets privados: `adjuntos` (versionado), `respaldos-pitr` (versionado) y `respaldos-inmutables` con una *retention rule* de 30 días **sin bloquear** (bloquearla es un paso manual documentado, posterior a la primera prueba de restauración). Política de ciclo de vida para borrar respaldos después de 90 días.
   - **Dynamic group** de la instancia y políticas IAM de mínimo privilegio: leer solo sus secretos, leer/escribir objetos solo en sus buckets, crear objetos (sin borrar ni sobrescribir) en `respaldos-inmutables`, y nada más.
   - Grupos IAM `soporte-infra` y `soporte-auditoria`, preparados para federarse con Microsoft Entra ID.
   - OCI Bastion, Cloud Guard (objetivo sobre el compartimento), Security Zone con la receta recomendada, Vulnerability Scanning, Logging (agente unificado), alarmas de Monitoring, *topic* de Notifications (por correo al canal de Teams) y **Budget con alertas** al 50 %, 80 % y 100 % de un monto configurable.
   - *Backend* remoto del estado en un bucket de OCI con versionado; el estado nunca va al repositorio.
   - Valida con `terraform fmt -check`, `terraform validate`, `tflint` y un escaneo de configuración (Trivy o Checkov) en CI. **No ejecutes `apply`.**
2. **`infra/cloud-init/`**: Docker y Compose, `ufw` (entrada denegada), `unattended-upgrades` (solo seguridad), `auditd`, endurecimiento CIS nivel 1 donde no rompa nada, OCI CLI, montaje del volumen de datos, usuarios Linux sin contraseña, `sshd` solo con certificados firmados por la CA de Cloudflare Access, y las unidades de systemd de `secrets-sync`, `deployer` y los respaldos.
3. **`deploy/`**:
   - `docker-compose.prod.yml`: imágenes por *digest*, `read_only`, `no-new-privileges`, límites de memoria por servicio (en total < 11 GB), redes internas, solo `cloudflared` con salida al exterior, PostgreSQL sin puertos publicados, secretos como Docker secrets.
   - `secrets-sync`: obtiene los secretos de OCI Vault con *instance principals* y los escribe en `tmpfs` con permisos `0400`.
   - `deployer` (*pull-based*, sin credenciales de nube en GitHub): un *timer* lee el manifiesto de la versión aprobada, verifica la firma cosign de cada imagen contra la identidad del workflow de GitHub, hace respaldo previo, ejecuta migraciones con el usuario de migraciones, levanta la nueva versión, espera `/ready` y, si falla, **revierte** a los *digests* anteriores. El token de lectura del registro de imágenes vive en Vault.
   - **pgBackRest**: repositorio en `respaldos-pitr` vía la API compatible con S3 de OCI (requiere una *Customer Secret Key* de un usuario de servicio limitado a ese bucket, guardada en Vault y con rotación cada 90 días). Completo semanal, diferencial diario, WAL continuo (`archive_timeout=60s`), cifrado del lado del cliente, retención de 35 días y `pgbackrest check` cada hora.
   - **Volcado inmutable**: `pg_dump` diario cifrado con `age` (llave pública en el servidor; la privada fuera del servidor) subido con nombre único a `respaldos-inmutables`. Nunca se sobrescribe, así que es compatible con la *retention rule*.
   - `restore.sh` y `docs/runbooks/restauracion.md`: restauración completa y a un punto en el tiempo.
4. **Prueba automática de respaldo y restauración en CI**: con Docker Compose y MinIO como sustituto de Object Storage, crear datos → respaldar → destruir → restaurar a un punto en el tiempo → verificar. Así los scripts se prueban sin nube.
5. **`docs/despliegue.md`**: guía paso a paso para la persona que aprovisiona:
   - crear la cuenta de pago con región de origen Querétaro;
   - comprobar la capacidad de Ampere A1;
   - federar OCI con Entra ID;
   - `terraform apply`;
   - cargar los secretos;
   - configurar Cloudflare (Tunnel, WAF, Access con Entra ID para agentes y SSH);
   - crear el buzón `soporte@` en Microsoft 365, con el registro de aplicación acotado a ese buzón mediante *RBAC for Applications* de Exchange Online y SPF/DKIM/DMARC;
   - primer despliegue;
   - prueba de restauración;
   - **bloqueo** de la *retention rule*.

Accesos:

| Quién | Cómo |
|---|---|
| Clientes | `soporte.` público detrás de Cloudflare WAF; la app exige su cuenta por invitación + MFA |
| Agentes y admins | `agentes.` detrás de **Cloudflare Access** (Entra ID con MFA) **y además** el login de la app |
| Operadores de infraestructura | SSH vía Cloudflare Access con certificados de corta duración; emergencia: OCI Bastion (sesión con caducidad) o consola serie. Consola de OCI federada con Entra ID |
| La app y el servidor | *Instance principals* (sin llaves) para Vault y Object Storage; la única llave de larga duración es la del usuario de servicio de pgBackRest, acotada a un bucket y rotada cada 90 días |
| GitHub | Ninguna credencial de OCI: solo publica imágenes firmadas y el manifiesto; el servidor jala la versión |

---

## 3. Modelo de dominio

Entidades principales (ajusta los detalles, pero conserva los conceptos):

- **Organization**: cliente de Inncentives. Nombre, dominios de correo permitidos, contrato de soporte (`SupportPlan`), notas, activo/inactivo, campos personalizados.
- **User**: agente, administrador o cliente. Correo, nombre, teléfonos, idioma, zona horaria, organización principal y organizaciones secundarias, roles, estado (invitado, activo, bloqueado), MFA, preferencias de notificación, ausencia (*out of office*) con sustituto.
- **Role** y **Permission**: roles predefinidos `admin`, `agent`, `customer`, y roles personalizados.
- **Group**: cola de trabajo (por ejemplo "Soporte N1", "Soporte N2", "Implementación", "Facturación"). Firma, dirección de correo de salida, permisos por agente con niveles `read`, `create`, `change`, `overview`, `full`.
- **Ticket**: número legible (`YYYYMMDDNNNN`, configurable), título, estado, prioridad, grupo, propietario, cliente, organización, etiquetas, fechas SLA, tiempo contabilizado, campos personalizados.
- **TicketState**: `new`, `open`, `pending_reminder`, `pending_close`, `resolved`, `closed`, `merged`. Los estados pendientes tienen fecha objetivo.
- **TicketPriority**: `1 baja`, `2 normal`, `3 alta`, `4 crítica` (configurable).
- **Article**: cada mensaje del ticket. Tipo (`email`, `phone`, `note`, `web`, `system`), visibilidad (`public` o `internal`), remitente (`customer`, `agent`, `system`), cuerpo HTML sanitizado, cabeceras de correo, adjuntos y, en llamadas, dirección, número, duración y resultado.
- **Attachment**: metadatos, hash SHA-256, estado de escaneo (`pending`, `clean`, `infected`, `error`), bandera de posible dato sensible, clave de almacenamiento.
- **TicketLink**: relaciones `parent`/`child`/`related` y fusión.
- **Mention**, **Subscription** y **SharedDraft**.
- **Checklist** y **ChecklistItem** dentro del ticket.
- **TimeEntry**: minutos, tipo de actividad (configurable), agente, artículo relacionado, facturable sí/no.
- **Macro**, **TextModule** (atajo `::clave`, por idioma y grupo), **TicketTemplate** y **Signature**.
- **Overview**: vista guardada con condiciones, columnas, orden y roles con acceso.
- **Trigger**, **Scheduler** y **CoreWorkflow** (sección 4.5).
- **SupportPlan**: nombre del nivel de contrato, SLAs asociados, horas incluidas al mes y tarifas (para contabilidad de tiempo).
- **Sla**: condiciones de aplicación, tiempos de primera respuesta, actualización y solución por prioridad, y calendario.
- **BusinessCalendar**: zona horaria, horario por día de la semana y días festivos.
- **ObjectAttribute**: campos personalizados (gestor de objetos) para Ticket, User y Organization.
- **KnowledgeBase**, **KbCategory**, **KbAnswer** y **KbAnswerTranslation** (fase 2).
- **Webhook**, **ApiToken**, **Integration** (Azure DevOps y Teams, fase 2).
- **AuditLog**: inmutable (sección 5.9).
- **History**: historial de cambios por objeto, visible en la UI.

Campos personalizados que vienen precargados en Ticket (todos editables por un admin):

- `inncentives_environment`: Dev, QA, Prod.
- `inncentives_module`: Organización, Beneficiarios, Tablas dinámicas, Carga de datos, Calendarios, Planes de compensación, Procesos calendarizados, Flujos, Reportes, Portal, Centro de Comando, Seguridad/Usuarios, API, Otro.
- `category`: Incidente, Duda de uso, Solicitud de cambio, Error en cálculo, Carga de datos, Acceso/usuarios, Facturación.
- `impact`: Bloquea la operación / Afecta parcialmente / Sin impacto inmediato.
- `inncentives_version`, `plan_name`, `process_execution_id` (texto libre opcional).

---

## 4. Requisitos funcionales (paridad con Zammad)

### 4.1 Gestión de tickets

- Crear tickets desde correo, teléfono, el portal de clientes y la interfaz de agente (en nombre de un cliente).
- Vista de ticket con: hilo de artículos, barra lateral (cliente, organización con su plan de soporte y SLA, tickets recientes del cliente, campos, etiquetas, enlaces, checklist, tiempo contabilizado) y un editor de respuesta con tipo de artículo (correo, nota interna, llamada).
- Responder, responder a todos, reenviar, citar, añadir nota interna. Las notas internas **nunca** se exponen al cliente: la regla se aplica en la API, no solo en la UI.
- Cambiar estado, prioridad, grupo, propietario y campos en la misma acción que la respuesta.
- Fusionar tickets (el origen queda en estado `merged` y redirige), dividir un artículo a un ticket nuevo, vincular tickets.
- Etiquetas con autocompletado y gestión de etiquetas por admins.
- @menciones de agentes (generan notificación y suscripción) y suscribirse o dejar de seguir un ticket.
- **Detección de colisión en tiempo real:** mostrar los avatares de quién está viendo el ticket y quién está escribiendo; avisar si alguien guardó cambios mientras redactabas.
- **Borradores:** autoguardado local por ticket y borradores compartidos entre agentes.
- Macros, módulos de texto con `::atajo`, plantillas de ticket y firmas por grupo, todas con variables (`{{ticket.number}}`, `{{customer.firstname}}`, etc.) renderizadas en un motor seguro (sin ejecución de código, solo sustitución de una lista blanca de variables).
- Historial de cambios visible por ticket.
- Acciones masivas desde las vistas: asignar, cambiar estado o grupo, añadir etiqueta, aplicar macro.
- Atajos de teclado para las acciones frecuentes.
- Contabilidad de tiempo: al enviar un artículo, el agente puede registrar minutos y tipo de actividad (opcionalmente obligatorio según condiciones). Resumen por ticket, cliente y mes.

### 4.2 Canal: correo electrónico (MVP)

- Entrada mediante Microsoft Graph (suscripción a cambios o *polling* configurable) y adaptador IMAP como alternativa. En local, usar Mailpit para pruebas.
- **Hilos:** asociar respuestas al ticket por `In-Reply-To`/`References` y por el número de ticket en el asunto (`[Ticket#202610130001]`, prefijo configurable). Nunca asociar solo por el asunto sin número.
- **Filtros postmaster:** reglas sobre cabeceras y remitente para fijar grupo, prioridad, etiquetas, ignorar o marcar como spam.
- Protección contra bucles: detectar `Auto-Submitted`, `X-Auto-Response-Suppress`, `Precedence: bulk/auto_reply`, rebotes (DSN) y limitar las respuestas automáticas por remitente y hora.
- **Identificación del remitente** (los clientes son solo administradores registrados):
  - Remitente registrado y activo, con la autenticación de correo correcta: el ticket se asocia a ese usuario y a su organización.
  - Remitente desconocido, **o** el correo no pasa SPF/DKIM/DMARC (`Authentication-Results`): el ticket se crea en el grupo **"Por verificar"**, sin respuesta automática que revele información, y queda marcado para que un agente lo valide y lo asocie.
  - Nunca se crean usuarios cliente de forma automática a partir de un correo.
- Salida desde la dirección del grupo, con `Message-ID` propio, cabeceras de hilo y firma del grupo. Cola de envío con reintentos y estado de entrega visible en el artículo.
- Correos HTML: sanitizar con una lista blanca estricta, bloquear imágenes remotas por defecto (botón "mostrar imágenes"), convertir imágenes en línea (`cid:`) en adjuntos.
- Tamaño máximo de correo y de adjunto configurable.

### 4.3 Canal: teléfono (MVP)

El proveedor de telefonía aún no está definido. Por eso:

- **MVP:** registro manual de llamadas. El agente crea un ticket nuevo o añade un artículo de tipo `phone` a uno existente, con dirección (entrante/saliente), número, duración, resultado y notas. Al teclear un número, la UI busca al cliente por teléfono y muestra sus tickets abiertos.
- **Preparado para CTI:** define una interfaz `TelephonyProvider` y un endpoint de webhook genérico (eventos `newCall`, `answer`, `hangup`, autenticado con token y firma HMAC) que, cuando exista un proveedor, abra automáticamente la ficha del cliente para el agente (pantalla emergente) y registre el historial de llamadas. Implementa el webhook genérico con pruebas, aunque no se conecte a ningún proveedor real en el MVP.
- Fase 3: conector con un proveedor concreto (Teams Phone, Twilio, 3CX u otro; ver sección 10).

### 4.4 Portal de clientes y organizaciones

- Acceso **solo por invitación**: un admin o agente crea al usuario cliente dentro de una organización y el sistema envía una invitación de un solo uso con caducidad. **No hay auto-registro.**
- El cliente ve **sus** tickets; si su usuario tiene el permiso "ver tickets de la organización", ve también los de su organización (y de sus organizaciones secundarias, si se asignaron).
- El cliente puede crear tickets (formulario con los campos visibles para clientes y validados por Core Workflows), responder, adjuntar archivos, cerrar o reabrir según la configuración, y ver el estado. **Nunca** ve notas internas, propietario interno (opcional), tiempo contabilizado ni campos marcados como internos.
- Perfil: idioma, contraseña, MFA, sesiones activas, preferencias de notificación.
- Organizaciones: dominios, plan de soporte, SLA, miembros, campos personalizados, tickets de la organización.

### 4.5 Automatización

- **Triggers** (al crear/actualizar y según condiciones): acciones de asignar, cambiar campos, añadir etiquetas, enviar correo o nota, notificar a Teams (fase 2), disparar un webhook. Mostrar un aviso si hay riesgo de bucle y limitar las ejecuciones encadenadas.
- **Schedulers** (cada N minutos u horas, en horario configurable): por ejemplo cerrar tickets `pending_close` vencidos, reabrir `pending_reminder` vencidos y notificar al propietario, escalar tickets sin respuesta.
- **Core Workflows:** reglas de formulario por objeto y pantalla (crear o editar; agente o cliente) que muestran, ocultan, hacen obligatorio o de solo lectura, fijan valores o restringen opciones según otros campos. Se aplican **también en el servidor** al validar.
- **SLAs:** una o varias por condición (organización, plan de soporte, prioridad, categoría). Tiempos de primera respuesta, actualización y solución calculados **solo dentro del horario laboral del calendario**. Contadores visibles en el ticket y en las vistas, estados "en riesgo" (al 80 % por defecto) y "vencido", notificación a propietario, grupo y supervisor. Los estados pendientes pausan el reloj de solución (configurable).
- **Asignación:** manual por defecto; asignación automática opcional al abrir un ticket sin propietario (estilo Zammad *auto assignment*), por grupo.
- **Ausencias:** cuando un agente está fuera de oficina, las notificaciones y las vistas "mis tickets" se dirigen a su sustituto.

### 4.6 Calendario laboral por defecto

- `America/Mexico_City`, lunes a viernes, 09:00–18:30.
- Festivos de México precargados y editables: 1 de enero, primer lunes de febrero, tercer lunes de marzo, 1 de mayo, 16 de septiembre, tercer lunes de noviembre, 25 de diciembre y el 1 de octubre del año de transmisión del Poder Ejecutivo Federal. Permite añadir días adicionales (por ejemplo Jueves y Viernes Santo como días no laborables de la empresa).
- Calcula los festivos móviles por regla, no como fechas fijas; incluye pruebas unitarias para varios años.
- Cada SLA puede usar un calendario distinto (algunos clientes podrían contratar horario extendido).

### 4.7 Vistas, búsqueda y reportes

- **Vistas** predefinidas: Mis tickets, Mis tickets pendientes alcanzados, Sin asignar, Tickets escalados, Todos los abiertos, Por verificar, Mis menciones. Configurables por un admin (condiciones, columnas, orden, agrupación, roles).
- **Búsqueda global** con texto completo (español e inglés) en tickets, artículos, usuarios, organizaciones y base de conocimiento, más una sintaxis de filtros (`state:open owner:me org:"ACME" tag:calculo`). Los resultados respetan los permisos: la búsqueda nunca devuelve algo que el usuario no podría abrir.
- **Reportes (fase 2):** tickets creados/cerrados, tiempos de primera respuesta y solución, cumplimiento de SLA, reaperturas, carga por agente y grupo, tiempo contabilizado por organización y mes (contra las horas incluidas en su plan), top de módulos y categorías. Filtros por periodo, organización, grupo y agente. Exportar a CSV y XLSX (protegiendo contra inyección de fórmulas: prefijo `'` en celdas que empiecen con `= + - @`).

### 4.8 Notificaciones

- En la aplicación (tiempo real) y por correo, por evento (asignado, nueva respuesta del cliente, mención, SLA en riesgo o vencido, recordatorio pendiente) con preferencias por usuario.
- Teams (fase 2): canal por grupo mediante un webhook o un flujo de Workflows, con enlace al ticket y **sin incluir el contenido del mensaje del cliente** (solo número, título, organización, prioridad y evento).

### 4.9 Base de conocimiento (fase 2)

- **Solo para clientes autenticados** y agentes; no hay nada público. Respuestas internas visibles solo para agentes.
- Bilingüe español/inglés, con traducciones por respuesta, categorías anidadas, borradores, publicación programada, archivado e historial de versiones.
- Búsqueda en el portal de cliente y **sugerencia de artículos** mientras el cliente redacta un ticket nuevo.
- Desde el ticket, el agente busca e inserta un enlace o el contenido de una respuesta.
- Contenido inicial sugerido: temas de los manuales de usuario de Inncentives (lo cargará un humano; prepara la estructura de categorías por módulo).

### 4.10 Integraciones

- **Azure DevOps (fase 2):** desde un ticket, crear un work item (Bug o tarea) en el proyecto configurado o vincular uno existente. Mostrar su estado en la barra lateral, sincronizarlo periódicamente o por *service hooks* y añadir una nota interna cuando el work item cambie de estado. Autenticación con un PAT o service principal guardado como secreto, con permisos mínimos.
- **Microsoft Teams (fase 2):** notificaciones salientes descritas en 4.8.
- **SSO (fase 2):** OIDC genérico. Agentes con Microsoft Entra ID; clientes, opcionalmente, con el Identity Server de Inncentives. El SSO **no** sustituye el aprovisionamiento por invitación: solo se permite el inicio de sesión de cuentas que ya existen (vinculación por `sub` + emisor, no solo por correo).
- **API de Inncentives (fase 3, todavía no existe):** define desde ahora una interfaz `InncentivesClient` con un *mock*. Cuando exista la API: barra lateral con los ambientes del cliente, versión, últimas ejecuciones de procesos con error y eventos recientes de Bitácora; widget "Reportar un problema" dentro del Sistema administrativo que crea el ticket con el contexto (cliente, ambiente, módulo, URL, versión, hora y captura opcional).
- **API REST propia:** toda la funcionalidad de la UI expuesta con OpenAPI 3 generado, versionada (`/api/v1`) y con paginación por cursor.
- **Webhooks salientes:** configurables por trigger, firmados con HMAC-SHA256 con marca de tiempo (rechazo de repeticiones), reintentos con *backoff* y registro de entregas.

### 4.11 Administración

- Usuarios, organizaciones, grupos, roles, permisos, estados, prioridades, campos personalizados (gestor de objetos), Core Workflows, triggers, schedulers, SLAs, calendarios, macros, módulos de texto, plantillas, firmas, canales de correo, filtros postmaster, webhooks, tokens de API, integraciones, marca (logo y colores), idioma por defecto y políticas de seguridad (contraseñas, MFA, sesión, retención).
- Importación de organizaciones y usuarios por CSV (con validación previa y reporte de errores).
- "Ver como cliente": un admin puede previsualizar lo que ve un cliente, con motivo obligatorio y registro en auditoría (sección 5.3).

### 4.12 Funciones para fases posteriores (fase 3)

- Chat en vivo en el portal y en el widget de Inncentives.
- WhatsApp Business (API oficial de Meta) y SMS.
- Conector de telefonía con un proveedor concreto.
- IA (si se aprueba; ver 5.12 y sección 10): resumen de ticket, sugerencia de respuesta basada en la base de conocimiento, clasificación automática de categoría, módulo y prioridad, y asistente de redacción.

---

## 5. Requisitos de seguridad

Referencia: **OWASP ASVS 4.0 nivel 2** y los controles de ISO 27001:2022 Anexo A aplicables. Crea `docs/seguridad/matriz-asvs.md` con cada requisito, dónde se implementa y qué prueba lo verifica.

### 5.1 Autenticación

- Contraseñas con Argon2id (parámetros OWASP vigentes), mínimo 12 caracteres, verificación contra listas de contraseñas filtradas (k-anonymity de Have I Been Pwned, desactivable si no hay salida a internet) y sin reglas de composición arbitrarias.
- **MFA:** TOTP con códigos de recuperación en el MVP; WebAuthn/passkeys en fase 2. **Obligatorio para admins y agentes**; para clientes, configurable por organización (por defecto: recomendado, con aviso al iniciar sesión).
- Bloqueo progresivo y *rate limiting* por cuenta y por IP en el inicio de sesión, MFA, recuperación de contraseña e invitaciones. Mensajes de error que no revelen si una cuenta existe.
- Recuperación de contraseña e invitaciones con tokens de un solo uso, aleatorios (≥128 bits), guardados como hash y con caducidad corta.
- Notificación por correo al usuario de: nuevo inicio de sesión desde un dispositivo desconocido, cambio de contraseña, cambio de MFA.

### 5.2 Sesiones

- Sesiones del lado del servidor (en Redis) con cookie `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax` o `Strict`. Sin JWT en `localStorage`.
- Rotación del identificador al iniciar sesión y al elevar privilegios; expiración por inactividad (30 min para agentes y clientes, configurable) y absoluta (12 h).
- El usuario ve y revoca sus sesiones activas; un admin puede revocar las de cualquier usuario.
- Reautenticación para acciones sensibles (cambiar MFA, crear tokens de API, cambiar roles, exportar datos).

### 5.3 Autorización

- **Denegar por defecto.** Cada endpoint declara el permiso requerido; un guard global rechaza los que no lo declaren (prueba automatizada que recorre todas las rutas).
- Comprobaciones a nivel de objeto en el servidor para **cada** lectura y escritura: un cliente solo accede a tickets propios o de su organización autorizada; un agente solo a tickets de grupos donde tiene el nivel requerido.
- Aplica el filtro de acceso en la capa de consulta (un único *policy service* reutilizado por vistas, búsqueda, reportes, exportaciones, adjuntos, tiempo real y webhooks) para que ningún canal lateral filtre datos.
- Las notas internas, campos internos y metadatos internos se eliminan de las respuestas para clientes con DTOs específicos por rol, no ocultándolos en el frontend.
- Los eventos de Socket.IO se emiten solo a *rooms* autorizados, verificados en la suscripción.
- Pruebas de **IDOR** y de aislamiento entre organizaciones para cada recurso (sección 8).
- "Ver como cliente": solo admins, solo lectura, con motivo obligatorio, banner visible, límite de 15 minutos y registro en auditoría.

### 5.4 Seguridad web

- Content-Security-Policy estricta (sin `unsafe-inline` ni `unsafe-eval`, con nonces si hace falta), `frame-ancestors 'none'` (salvo la lista blanca del widget en fase 3), HSTS con `preload`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restrictiva.
- Protección CSRF (token sincronizado o *double submit* firmado) en todas las peticiones que cambian estado con cookie de sesión.
- CORS cerrado (solo el origen de la propia aplicación).
- Toda entrada validada con Zod en el servidor; consultas siempre parametrizadas (prohibido `$queryRawUnsafe` con interpolación).
- HTML de usuario (correos, editor, base de conocimiento) sanitizado en el servidor con lista blanca (DOMPurify en servidor o `sanitize-html`), con pruebas contra el *XSS Filter Evasion Cheat Sheet* de OWASP.
- Protección contra SSRF en webhooks e integraciones: solo HTTPS, resolución de DNS validada contra rangos privados, de *loopback* y de metadatos de nube, sin seguir redirecciones a esos rangos.
- Rate limiting global y por endpoint; límites de tamaño de cuerpo; paginación obligatoria.

### 5.5 Correo electrónico

- Validar SPF/DKIM/DMARC del correo entrante (resultado de `Authentication-Results` del proveedor) antes de confiar en el remitente (ver 4.2).
- Publicar SPF, DKIM y DMARC (`p=quarantine` o superior) para el dominio de salida; documentarlo en `docs/despliegue.md`.
- No reflejar contenido del ticket en respuestas automáticas a remitentes no verificados.
- Cabeceras de correo saliente sin inyección (validar saltos de línea en asunto y direcciones).

### 5.6 Adjuntos

- Lista blanca de extensiones **y** verificación del tipo real por *magic bytes*; tamaño máximo configurable (25 MB por defecto).
- Escaneo con ClamAV antes de que el adjunto sea descargable; los infectados se ponen en cuarentena, no se entregan y se notifica al agente y a un admin.
- Almacenamiento privado; descarga mediante URL firmada de corta duración (≤5 min) **después** de comprobar permisos. Se sirven con `Content-Disposition: attachment` desde un dominio o ruta sin cookies de sesión cuando sea posible, y con `X-Content-Type-Options: nosniff`.
- Vistas previas de imágenes recodificadas en el servidor (eliminando metadatos EXIF).
- Nombres de archivo saneados; nunca se usa el nombre original como ruta.

### 5.7 Protección de datos personales y de nómina

- **Detector de datos sensibles** en artículos y adjuntos de texto/CSV/XLSX: patrones de RFC, CURP, NSS, CLABE, números de tarjeta (con Luhn) y columnas tipo "sueldo/salario". Si encuentra coincidencias:
  - Al cliente, antes de enviar: aviso pidiendo que no comparta datos de empleados reales o que los anonimice.
  - En el ticket: bandera visible "contiene posibles datos personales" y opción para que un agente **redacte** el texto o elimine el adjunto (con registro en auditoría).
- **Retención** configurable por tipo de dato: por ejemplo eliminar adjuntos de tickets cerrados después de N días y anonimizar tickets después de M años. Los valores por defecto se dejan como pendientes (sección 10) pero el mecanismo debe existir en el MVP, deshabilitado hasta que se configure.
- **Derechos ARCO / GDPR:** exportar todos los datos de un usuario (JSON + adjuntos en ZIP) y anonimizar o eliminar a un usuario y sus datos con una tarea de "Data privacy" auditada, como en Zammad.
- Datos mínimos: no pedir datos personales que no se necesiten para el soporte.
- Aviso de privacidad configurable y visible en el portal.

### 5.8 Cifrado y secretos

- TLS 1.2+ (preferible 1.3) en todo el tráfico externo; entre servicios internos, TLS o red privada aislada.
- Cifrado en reposo del disco, de la base de datos y del almacenamiento de objetos. Cifrado a nivel de campo (AES-256-GCM, con llave de un proveedor de secretos) para secretos de integraciones, semillas TOTP y tokens de terceros.
- Tokens de API guardados como hash, mostrados una sola vez, con *scopes*, expiración obligatoria y fecha de último uso.
- Ningún secreto en el repositorio, en imágenes Docker, en variables de entorno, en el estado de Terraform ni en logs. Escaneo de secretos en CI (gitleaks).
- En producción, los secretos viven en OCI Vault (llave maestra en HSM) y llegan a la app como archivos en `tmpfs` (sección 2.1). Los buckets y volúmenes se cifran con la llave del Vault.

### 5.9 Auditoría y registros

- **AuditLog append-only** (sin UPDATE/DELETE para el usuario de la aplicación; cadena de hash entre registros para detectar alteraciones) con: inicios de sesión exitosos y fallidos, MFA, cambios de roles y permisos, invitaciones, creación y revocación de tokens, "ver como cliente", exportaciones, descargas de adjuntos, redacciones, anonimizaciones, cambios de configuración de seguridad y de integraciones.
- Cada registro: actor, acción, objeto, antes/después (sin secretos), IP, user-agent, ID de correlación y marca de tiempo UTC.
- Vista de auditoría para admins con filtros y exportación.
- Los logs técnicos nunca contienen contraseñas, tokens, cuerpos de correo ni datos personales (redacción automática en el logger). Retención y envío a un SIEM documentados.

### 5.10 Disponibilidad y continuidad

- Respaldos automáticos cifrados de PostgreSQL fuera del servidor: pgBackRest con restauración a un punto en el tiempo (35 días) y un volcado diario en un bucket inmutable (90 días). Los adjuntos viven en Object Storage con versionado, fuera del servidor.
- **Script de restauración probado automáticamente en CI** (sección 2.1, punto 4) y prueba real trimestral documentada.
- Objetivos: RPO ≤ 5 min (WAL continuo; ≤ 24 h en el peor caso, restaurando desde el bucket inmutable) y RTO ≤ 4 h (reconstrucción del servidor con Terraform y cloud-init + restauración).
- *Health checks*, reinicio automático de contenedores y alertas básicas (caída del servicio, cola de correo atascada, fallos de escaneo, espacio en disco).

### 5.11 Ciclo de desarrollo seguro

- CI (GitHub Actions o Azure Pipelines; dejar GitHub Actions por defecto): lint, typecheck, pruebas, cobertura mínima del 80 % en `packages/shared` y en los servicios de autorización/SLA, SAST (Semgrep o CodeQL), auditoría de dependencias (`pnpm audit` + Dependabot/Renovate), escaneo de secretos (gitleaks), escaneo de imágenes (Trivy), y DAST básico (OWASP ZAP baseline) contra el entorno de pruebas en fase 2.
- Dependencias fijadas por *lockfile*; contenedores no-root, sistema de archivos de solo lectura donde sea posible y sin capacidades extra.
- Imágenes multi-arquitectura (`amd64` + `arm64`) firmadas con cosign (*keyless*, identidad OIDC del workflow) y con SBOM adjunto. Producción solo acepta imágenes firmadas por el workflow de `main`.
- Infraestructura como código revisada en CI: `terraform validate`, `tflint`, escaneo de configuración (Trivy/Checkov) y `shellcheck` para los scripts de `deploy/`.
- `SECURITY.md` con el proceso de reporte de vulnerabilidades y `docs/seguridad/respuesta-incidentes.md` con el procedimiento de incidentes y la notificación a afectados según la ley.
- Modelo de amenazas (STRIDE) en `docs/seguridad/modelo-amenazas.md`, actualizado al final de cada fase.

### 5.12 IA (solo si se aprueba; fase 3)

- Deshabilitada por defecto, activable por organización.
- Proveedor que contractualmente no entrene con los datos y con residencia de datos aceptable (por ejemplo, Claude a través de Microsoft Foundry o de la API de Anthropic con retención cero).
- Redacción de datos personales (detector de 5.7) **antes** de enviar texto al modelo; adjuntos nunca se envían.
- Todo resultado es una sugerencia que un agente revisa; nunca se envía nada al cliente de forma automática.
- Registro de cada solicitud (quién, ticket, propósito) en auditoría.

---

## 6. Plan por fases

### Fase 0: Cimientos (antes de cualquier funcionalidad)

- Monorepo, Docker Compose local (Postgres, Redis, MinIO, ClamAV, Mailpit), CI completo de la sección 5.11 con imágenes `amd64`/`arm64` firmadas, convenciones de código.
- Módulos transversales: configuración, logger con redacción, manejo de errores, validación, *policy service* de autorización, auditoría, i18n, *seeding* de datos de demostración.
- Adaptadores de infraestructura: `StorageProvider` (S3/MinIO y OCI nativo con *instance principals*) y `SecretsProvider` (archivos), con pruebas.
- Hosts separados para portal de clientes y área de agentes/admin, y manejo de `CF-Connecting-IP`.
- Autenticación local + TOTP + sesiones + invitaciones + recuperación de contraseña.
- **Infraestructura de OCI como código, cloud-init, `deploy/` (compose de producción, `secrets-sync`, `deployer` con verificación de firmas y *rollback*, pgBackRest, volcado inmutable, restauración) y la prueba automática de respaldo/restauración en CI** (sección 2.1).
- `docs/despliegue.md` y runbooks (restauración, rotación de secretos, respuesta a incidentes).
- ADRs iniciales, `docs/PROGRESO.md`, modelo de amenazas inicial (incluida la infraestructura).

### Fase 1: MVP

- Tickets completos (4.1), incluida la contabilidad de tiempo.
- Canal de correo (4.2) con buzón configurable y Mailpit en local.
- Canal de teléfono (4.3): registro manual, búsqueda por número y webhook CTI genérico.
- Portal de clientes por invitación (4.4).
- Organizaciones, planes de soporte, grupos, roles y permisos.
- SLAs con calendario laboral de México y escalamientos (4.5, 4.6).
- Triggers, schedulers, Core Workflows y macros, módulos de texto, plantillas y firmas.
- Vistas y búsqueda de texto completo (4.7, sin reportes avanzados).
- Notificaciones en la aplicación y por correo (4.8).
- Administración de todo lo anterior (4.11) y campos personalizados.
- Seguridad: todos los puntos de la sección 5 excepto WebAuthn, SSO, DAST e IA. El detector de datos sensibles y el mecanismo de retención **sí** entran en el MVP.
- Documentación: guía de despliegue (ambas opciones), manual de administrador y manual de agente breves.

### Fase 2: Conocimiento, integraciones y reportes

- Base de conocimiento bilingüe para clientes autenticados (4.9).
- Reportes y tablero (4.7), incluyendo horas consumidas por organización contra su plan.
- Azure DevOps y Teams (4.10).
- SSO OIDC (Entra ID para agentes; Identity Server de Inncentives para clientes, opcional).
- WebAuthn/passkeys, DAST en CI, webhooks salientes configurables por el usuario.
- Importación por CSV de organizaciones y usuarios.

### Fase 3: Canales adicionales e Inncentives

- Integración con la API de Inncentives: barra lateral y widget "Reportar un problema" (4.10).
- Conector de telefonía con proveedor real.
- Chat en vivo, WhatsApp Business y SMS.
- IA (si se aprueba, con 5.12).

---

## 7. Experiencia de usuario

- Diseño limpio y denso en información para agentes (estilo Zammad): navegación lateral con vistas y sus contadores, pestañas de tickets abiertos, barra de búsqueda global, panel de ticket con barra lateral derecha.
- Portal de clientes simple: mis tickets, nuevo ticket, base de conocimiento, perfil.
- Accesibilidad WCAG 2.1 AA, modo oscuro y diseño responsivo (los agentes pueden atender desde el celular).
- Formatos de fecha y número según el idioma; fechas mostradas en la zona horaria del usuario y guardadas en UTC.
- Marca configurable (logo, color principal, nombre "Soporte Inncentives").

---

## 8. Estrategia de pruebas

- **Unidad:** cálculo de SLA (con festivos, fines de semana, pausas, cambios de prioridad), asociación de correos a tickets, filtros postmaster, motor de condiciones de triggers/workflows, detector de datos sensibles, sanitización HTML, plantillas de variables.
- **Integración (Testcontainers):** flujos completos de correo entrante → ticket → respuesta → correo saliente, escaneo de adjuntos, búsqueda.
- **Autorización:** una matriz de pruebas generada por cada recurso × rol × relación (propio, misma organización, otra organización, grupo sin permiso) que verifica que el acceso coincide con lo esperado en lectura, escritura, búsqueda, exportación, adjuntos y eventos en tiempo real.
- **E2E (Playwright):** crear ticket desde el portal, atender como agente, nota interna invisible para el cliente, fusión, SLA en riesgo, MFA, invitación, recuperación de contraseña.
- **Seguridad:** pruebas de XSS en correos y editor, CSRF, cabeceras, rate limiting, enumeración de cuentas, subida de archivos maliciosos (EICAR), SSRF en webhooks.
- Datos de prueba siempre ficticios (generados); nunca datos reales de clientes.

---

## 9. Definición de terminado (por fase)

Una fase está terminada cuando:

1. Todas sus funciones tienen pruebas y el CI está en verde (incluidos SAST, dependencias, secretos e imágenes, sin hallazgos altos o críticos abiertos).
2. La matriz de autorización cubre todos los recursos nuevos.
3. `docker compose up` levanta la aplicación desde cero con datos de demostración, y la guía de despliegue funciona tal como está escrita.
4. `docs/PROGRESO.md`, la matriz ASVS, el modelo de amenazas y los ADRs están actualizados.
5. Existe un resumen de la fase en `docs/fases/fase-N.md` con lo entregado, lo que quedó fuera y los riesgos conocidos.

Además, para la **fase 0**:

6. Las imágenes se construyen y arrancan en `linux/arm64` (al menos una prueba de humo bajo emulación o en un *runner* ARM).
7. Terraform pasa `fmt`, `validate`, `tflint` y el escaneo de configuración sin hallazgos altos; los scripts pasan `shellcheck`.
8. La prueba automática de respaldo → destrucción → restauración a un punto en el tiempo pasa en CI.
9. `docs/despliegue.md` permite a una persona sin contexto aprovisionar todo, con una lista de verificación final.

---

## 10. Decisiones pendientes (usar el valor por defecto y dejarlo configurable)

| # | Tema | Valor por defecto mientras se decide |
|---|---|---|
| 1 | Volumen esperado (agentes, clientes, tickets/mes) | Diseñar para 50 agentes, 300 organizaciones y 5,000 tickets/mes en una sola VM; documentar cómo escalar. |
| 2 | Niveles de soporte N1/N2/N3 y sus grupos | Crear grupos "Soporte N1", "Soporte N2", "Soporte N3"; escalamiento manual entre grupos. |
| 3 | Planes de soporte y SLAs por cliente | Plan "Estándar" de ejemplo: crítica 1 h / 4 h, alta 2 h / 8 h, normal 4 h / 24 h, baja 8 h / 40 h (respuesta / solución, en horas hábiles). Todo editable. |
| 4 | Proveedor de identidad para SSO | Autenticación local con MFA; OIDC en fase 2. |
| 5 | MFA para clientes | Recomendado, no obligatorio; configurable por organización. |
| 6 | Buzón y dominio de correo | Variables de entorno; adaptador Graph y adaptador IMAP/SMTP; Mailpit en local. |
| 7 | Proveedor de telefonía | Registro manual y webhook CTI genérico. |
| 8 | Infraestructura y residencia de datos | **Decidido:** OCI región Querétaro (*Always Free*, cuenta de pago por uso) detrás de Cloudflare (sección 2.1). |
| 9 | Retención de datos y alcance ISO 27001 | Mecanismo implementado pero deshabilitado; sin borrado automático hasta que se configure. |
| 10 | IA | Deshabilitada; no se implementa antes de la fase 3. |
| 11 | RPO/RTO | RPO ≤ 5 min (≤ 24 h en el peor caso), RTO ≤ 4 h. |
| 12 | Entorno de *staging* | Sin servidor propio por ahora: CI y Docker Compose local. La configuración de Terraform admite un segundo entorno (`staging`) con variables. |
| 13 | Plan de Cloudflare | Free; documentar qué reglas de WAF añade Pro para decidir después. |
| 14 | Monto del presupuesto y destinatarios de alertas | Variables de Terraform sin valor por defecto; la persona que aprovisiona las define. |

---

## 11. Primer paso

1. Lee todo este documento y genera `docs/PROGRESO.md` con el desglose de tareas de la fase 0 y la fase 1.
2. Escribe los ADRs iniciales (stack, autorización, almacenamiento de archivos, secretos, correo, infraestructura en OCI, despliegue *pull-based*, respaldos).
3. Escribe el modelo de amenazas inicial.
4. Empieza la fase 0. Al terminarla, **detente** y espera aprobación antes de la fase 1.
