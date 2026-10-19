# ADR-0012: Canal de correo entrante y saliente

- **Estado:** aceptada (fase 1; reemplaza la parte "Graph en fase 1" de ADR-0006)
- **Decisión:**
  - **Adaptadores:** Microsoft Graph (credenciales de cliente, buzón acotado con *RBAC for Applications*) y, como alternativa, IMAP/SMTP con TLS. Ambos implementan `MailboxAdapter` (`fetch` + `send`). En desarrollo y CI se usa GreenMail (IMAP + SMTP) y Mailpit para el correo del sistema.
  - **Proceso `jobs`:** la ingesta (cada minuto) y el envío (cola `outbound`, reintentos exponenciales, estado de entrega visible en el artículo) corren en un proceso separado con la misma imagen de la API, sin puerto HTTP.
  - **Identidad del remitente:** solo se confía en el encabezado `Authentication-Results` escrito por el servidor configurado (`trustedAuthServ`), nunca en uno agregado por el remitente. Remitente registrado y activo + DMARC (o SPF+DKIM) `pass` → ticket del cliente. Cualquier otro caso → grupo **"Por verificar"**, sin cliente, sin respuesta automática y con la etiqueta `por-verificar`. Nunca se crean clientes desde un correo.
  - **Hilos:** primero por `In-Reply-To`/`References` contra nuestros `Message-ID` (`<id-del-artículo@dominio>`), después por `[Ticket#NNNN]` en el asunto. Nunca por el asunto sin número. Un seguimiento solo se agrega si el remitente es el cliente del ticket, un colega con acceso a la organización o personal con acceso al grupo; si no, se crea un ticket nuevo.
  - **Antibucles:** se ignoran nuestros propios correos (`X-Loop: mesa-soporte`, direcciones de canales); los rebotes (DSN) marcan como fallido el artículo original; el correo saliente lleva `X-Auto-Response-Suppress` y, si es automático, `Auto-Submitted: auto-replied`.
  - **Contenido:** HTML saneado con lista blanca; las imágenes remotas se bloquean (`data-remote-src`) y solo se cargan si el agente pulsa "Mostrar imágenes"; las imágenes `cid:` se guardan como adjuntos. Duplicados por hash del `Message-ID`.
- **Consecuencias:** sin `trustedAuthServ` todo el correo cae en "Por verificar" (seguro por defecto, la API lo advierte al guardar el canal).
