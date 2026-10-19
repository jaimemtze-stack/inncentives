# ADR-0006: Correo saliente por cola

- **Estado:** aceptada (fase 0: SMTP; Graph en fase 1)
- **Decisión:**
  - **Cola:** la API encola trabajos `mail` en BullMQ y el worker los entrega con reintentos exponenciales. Un correo caído nunca bloquea una petición.
  - **Enlaces de un solo uso:** el token va en el fragmento (`#token=`), que el navegador no envía al servidor ni en `Referer`. La web lo lee y lo borra del historial.
  - **Plantillas:** en español e inglés; todo valor interpolado se escapa en HTML.
  - **Transporte de la fase 0:** SMTP con STARTTLS obligatorio en producción (`SMTP_TLS=none` solo para Mailpit). En la fase 1 se agrega el adaptador de Microsoft Graph acotado al buzón `soporte@` con *RBAC for Applications*.
  - **Retención en la cola:** los trabajos completados se borran de Redis (`removeOnComplete`), porque contienen enlaces de un solo uso.
