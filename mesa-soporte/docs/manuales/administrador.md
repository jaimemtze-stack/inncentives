# Manual corto del administrador

Todo se configura en **Configuración** (host de agentes). Cada cambio queda en la bitácora con el valor anterior y el nuevo. Las acciones sensibles (accesos a grupos, roles, privacidad, tokens, "ver como cliente") piden tu contraseña otra vez.

## 1. Primeros pasos después de instalar

1. **Grupos** (ya existen *Soporte N1*, *N2*, *N3* y el grupo del sistema *Por verificar*). Asigna la dirección de correo de cada grupo y su firma.
2. **Agentes y accesos:** invita a cada agente desde *Organizaciones → Invitar* y después dale acceso a grupos en *Configuración → Agentes y accesos*:
   - `full`: todo. `change`: leer y modificar. `read`: solo leer. `create`: crear tickets en el grupo. `overview`: verlo en las vistas.
3. **Canal de correo** (*Canales de correo*): adaptador `graph` (recomendado) con `tenantId`, `clientId`, `mailbox` y `secretName: graph_client_secret`. Configura `trustedAuthServ` con el servidor que firma `Authentication-Results` (en Microsoft 365: `mx.microsoft.com` o el que aparezca en tus encabezados). **Sin ese dato todos los correos van a "Por verificar".**
4. **Calendario y SLA:** el calendario por defecto es lunes a viernes de 9:00 a 18:30 (Ciudad de México) con los días feriados de la LFT. Agrega días inhábiles propios en `holidays` (`AAAA-MM-DD`). El SLA *Estándar* trae tiempos por prioridad (en minutos hábiles); crea SLAs por cliente o plan con condiciones (`organization.support_plan_id`, `ticket.organization_id`…) y ordénalos con `position` (gana el primero que coincide).
5. **Ajustes generales:** prefijo del número de ticket, contabilidad de tiempo (habilitada / obligatoria), si el cliente puede cerrar tickets, límite de respuestas automáticas por hora, grupo de entrada del portal, aviso de privacidad (es/en) y marca.

## 2. Reglas (triggers, planificadores, vistas, Core Workflows, macros)

Se editan como JSON. La API rechaza campos u operadores desconocidos y muestra advertencias de bucle.

```json
{
  "name": "Acuse de recibo por correo",
  "event": "create",
  "conditions": { "op": "and", "conditions": [{ "field": "ticket.channel", "operator": "is", "value": "email" }] },
  "actions": [{ "type": "reply_customer", "subject": "Recibimos tu solicitud", "body": "Hola {{customer.firstname}}, tu ticket es {{ticket.number}}." }]
}
```

- Campos: `ticket.state`, `ticket.priority_id`, `ticket.group_id`, `ticket.owner_id`, `ticket.tags`, `ticket.channel`, `ticket.custom.<campo>`, `article.type`, `article.sender`, `customer.email`, `organization.support_plan_id`, entre otros. `current_user` sirve como valor en vistas.
- Operadores: `is`, `is_not`, `in`, `not_in`, `contains`, `starts_with`, `is_set`, `not_set`, `before_relative`/`after_relative` (`{"minutes": -60}`), y en triggers `changed`/`changed_to`.
- Acciones: `set` (state, priority_id, group_id, owner_id, pending_until_minutes), `set_custom`, `add_tags`, `remove_tags`, `notify`, `add_note`, `reply_customer`, `webhook`.
- Variables de plantilla: `ticket.number`, `ticket.title`, `ticket.state`, `ticket.priority`, `ticket.group`, `ticket.url`, `customer.name`, `customer.firstname`, `customer.email`, `organization.name`, `owner.name`, `agent.name`, `config.app_name`.
- Los **planificadores** necesitan al menos una condición y pueden limitarse a horario hábil (`calendarId`).
- **Core Workflows**: por pantalla (`create_agent`, `create_customer`, `edit_agent`, `edit_customer`) marcan campos como obligatorios, de solo lectura o con opciones restringidas. Se aplican también en el servidor.

## 3. Campos personalizados

*Campos personalizados*: tipo (`text`, `textarea`, `select`, `multiselect`, `boolean`, `integer`, `date`), opciones, obligatorio, visible y editable por el cliente. Ya existen: ambiente, módulo de Inncentives, categoría, impacto, versión, plan de compensación e ID de ejecución.

## 4. Webhooks y Teams

Solo HTTPS hacia direcciones públicas (se bloquean redes privadas, *loopback* y metadatos de nube). Con `secret`, cada llamada lleva `X-Mesa-Signature: t=<unix>,v1=<HMAC-SHA256 de "t.cuerpo">`. El cuerpo contiene metadatos del ticket, nunca el texto de los artículos ni datos de contacto.

**Canales de Teams** (fase 2): `groupId`, `name`, `url` (la del flujo de *Workflows* del canal) y `events` (`ticket_created`, `ticket_assigned`, `customer_reply`, `sla_warning`, `sla_breach`). La URL se guarda cifrada y no se vuelve a mostrar (para cambiarla, escribe una nueva). La tarjeta solo lleva número, título, organización, prioridad y enlace.

En ambos, el botón **Entregas** muestra los últimos 100 intentos con su resultado HTTP y duración.

## 5. Privacidad y retención

- **Retención** (*Retención*): dos políticas desactivadas por defecto. Actívalas solo cuando Neitek defina plazos (pendiente 9).
- **Privacidad (ARCO):** `export` (ZIP con JSON y adjuntos, descarga con URL de 2 min), `anonymize` (personal o clientes) y `delete` (solo clientes: borra el usuario y sus tickets). Siempre con motivo; todo se audita.
- **Ver como cliente:** escribe el ID del cliente y el motivo; verás su portal en solo lectura durante 15 minutos.

## 6. Telefonía (CTI)

Hasta elegir proveedor, los agentes registran llamadas a mano. El webhook genérico está listo en `POST https://soporte.inncentives.com/hooks/cti` con `X-Mesa-Signature` (secreto `cti_webhook_secret`, tolerancia 5 minutos, cada firma se acepta una sola vez) y eventos `newCall`, `answer`, `hangup`.

## 7. Base de conocimiento (fase 2)

- Quien redacta necesita el permiso `kb.edit` (crea un rol personalizado con él y asígnalo en *Agentes y accesos*).
- *Base de conocimiento → Nueva respuesta*: categoría (ya existen las de cada módulo de Inncentives), visibilidad (`customer` o `internal`), estado (`draft`, `published`, `archived`) y, opcionalmente, fecha de publicación. Cada idioma (es-MX / en) se guarda por separado y conserva su historial de versiones.
- Los clientes solo ven respuestas publicadas, visibles para clientes y con la fecha de publicación cumplida.

## 8. Reportes (fase 2)

*Reportes* (permiso `reports.read`): periodo de hasta 400 días con filtros por organización y grupo. Incluye creados/cerrados por día, primera respuesta y solución (promedio, mediana, p90), cumplimiento de SLA, reaperturas, carga por agente y grupo, **horas por organización contra su plan** y módulos/categorías frecuentes. *CSV* y *XLSX* descargan la lista de tickets; las celdas que empiezan con `=`, `+`, `-` o `@` se exportan como texto para que Excel no las ejecute. Cada descarga queda en la bitácora.

## 9. Importar organizaciones y usuarios (fase 2)

*Administración → Importar desde CSV* (separador `,` o `;`, UTF-8, máximo 5 000 filas):

- **Organizaciones:** `nombre`, `dominios` (separados por `|`), `plan` (nombre de un plan existente), `mfa` (`sí`/`no`).
- **Usuarios:** `correo`, `nombre`, `organizacion` (nombre exacto), `rol` (por defecto `CUSTOMER`; los roles de personal requieren permiso para invitar personal). Cada fila crea una **invitación**, no una cuenta.

Primero pulsa **Validar**: verás cuántas filas son válidas y una tabla de errores por fila y campo. Si hay un solo error, **no se guarda nada**; corrige el archivo y vuelve a validar. Después pulsa **Importar**.

## 10. Integraciones (fase 2)

- **SSO:** proveedores en `sso_providers` de *Ajustes generales* (ver `despliegue.md` §9 ter). Nadie entra por SSO sin haber vinculado antes su cuenta desde *Mi cuenta*.
- **Azure DevOps:** `azure_devops` en *Ajustes generales* (`organization`, `project`, `defaultType`). Desde un ticket, los agentes crean o vinculan *work items*; los cambios de estado llegan como nota interna.
- **API:** la descripción OpenAPI 3.1 está en `GET /api/v1/openapi.json` (host de agentes, con sesión o token de API). Cada operación indica los permisos que exige (`x-permissions`) y si pide reautenticación (`x-reauth`).

## 11. Inncentives (fase 3)

- En *Administración → Organizaciones* captura la **clave de Inncentives** de cada cliente (minúsculas, números y guiones). Con ella los agentes ven en el ticket los ambientes, versión, procesos con error y Bitácora reciente del cliente, y el widget "Reportar un problema" reconoce al cliente.
- *Ajustes generales → `inncentives`*: `mode` (`off` hasta que exista la API, `http` después), `baseUrl`, nombres de los secretos y `widgetIssuer`.

## 12. WhatsApp, SMS y teléfono (fase 3)

- *Configuración → WhatsApp y SMS*: un registro por número con `kind` (`whatsapp`/`sms`), `providerId` (Phone number ID de Meta, o el número de Twilio), `displayNumber` (E.164) y el grupo que lo atiende.
- *Ajustes generales → `messaging`*: `twilioAccountSid`, versión de la API de WhatsApp y `reopenDays` (un mensaje nuevo continúa el ticket del contacto actualizado en esos días; después abre otro).
- Los números se reconocen por el **teléfono o celular** del cliente; registra ambos en su ficha. Los desconocidos llegan a *Por verificar*.
- Las llamadas de Twilio aparecen en *Teléfono* y como aviso al agente.

## 13. Chat en vivo (fase 3)

*Ajustes generales → `chat`*: `enabled`, `groupId` (quién atiende) e `idleMinutes` (cierre por inactividad). El cliente solo ve el chat cuando al menos un agente del grupo está *Disponible*. Cada chat queda como ticket de canal `chat`.

## 14. IA (fase 3, solo con aprobación)

Desactivada por defecto. Para activarla: aprobación de Neitek, llave `anthropic_api_key` de una organización con retención cero, `ai.enabled: true` en *Ajustes generales* y la casilla **IA** en cada organización que la autorice (requiere `admin.config`). Antes de enviar se ocultan datos personales; los adjuntos nunca se envían; cada uso queda en la bitácora como `ai.request` y hay un límite de 60 por hora por agente.
