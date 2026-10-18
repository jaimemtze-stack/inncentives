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

## 4. Webhooks

Solo HTTPS hacia direcciones públicas (se bloquean redes privadas, *loopback* y metadatos de nube). Con `secret`, cada llamada lleva `X-Mesa-Signature: t=<unix>,v1=<HMAC-SHA256 de "t.cuerpo">`. El cuerpo contiene metadatos del ticket, nunca el texto de los artículos ni datos de contacto.

## 5. Privacidad y retención

- **Retención** (*Retención*): dos políticas desactivadas por defecto. Actívalas solo cuando Neitek defina plazos (pendiente 9).
- **Privacidad (ARCO):** `export` (ZIP con JSON y adjuntos, descarga con URL de 2 min), `anonymize` (personal o clientes) y `delete` (solo clientes: borra el usuario y sus tickets). Siempre con motivo; todo se audita.
- **Ver como cliente:** escribe el ID del cliente y el motivo; verás su portal en solo lectura durante 15 minutos.

## 6. Telefonía (CTI)

Hasta elegir proveedor, los agentes registran llamadas a mano. El webhook genérico está listo en `POST https://soporte.inncentives.com/hooks/cti` con `X-Mesa-Signature` (secreto `cti_webhook_secret`, tolerancia 5 minutos, cada firma se acepta una sola vez) y eventos `newCall`, `answer`, `hangup`.
