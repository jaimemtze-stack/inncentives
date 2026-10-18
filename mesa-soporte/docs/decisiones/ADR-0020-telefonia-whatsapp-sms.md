# ADR-0020: Telefonía (Twilio), WhatsApp Business y SMS

- **Estado:** aceptada (fase 3)
- **Contexto:** el proveedor de telefonía seguía sin definirse (pendiente 7). La fase 3 pide un conector real, WhatsApp Business (API oficial de Meta) y SMS.
- **Decisión:**
  - **Twilio** como proveedor de referencia: voz y SMS con la misma cuenta y la misma verificación (`X-Twilio-Signature`, HMAC-SHA1 de la URL pública más los parámetros ordenados, comprobado con el vector de prueba oficial). El conector implementa `TelephonyProvider` y alimenta el mismo flujo que el webhook CTI genérico (bitácora de llamadas, aviso al agente). El agente se puede indicar con `?agent=<correo>` en la URL del *status callback* (queda cubierto por la firma). Teams Phone o 3CX se agregarían como otro `TelephonyProvider`.
  - **WhatsApp Cloud API** (Meta): verificación de la suscripción con `whatsapp_verify_token`, firma `X-Hub-Signature-256` con el *app secret* sobre el cuerpo exacto, envío con el token de usuario de sistema. Los adjuntos entrantes se descargan solo de hosts de Meta y pasan por el antivirus. Se respeta la **ventana de 24 h**: fuera de ella el agente recibe un aviso (las plantillas aprobadas quedan para después).
  - **Mismo criterio que el correo:** un número conocido (teléfono o celular del cliente) crea o continúa su ticket del canal; uno desconocido va a **Por verificar** sin cliente. Cada mensaje se deduplica por su id del proveedor (`articles.external_id`, único). Las respuestas salen por la cola del proceso `jobs` con reintentos; los acuses (enviado, entregado, leído, fallido) solo avanzan.
  - Las rutas `/hooks/*` viven en el host del portal (sin Cloudflare Access) y se autentican por firma; sin firma válida responden 401.
- **Consecuencias:** sin MMS ni envío de adjuntos por WhatsApp/SMS (solo texto saliente). Cambiar de proveedor de SMS implica otro parser y cliente, no cambios en tickets.
