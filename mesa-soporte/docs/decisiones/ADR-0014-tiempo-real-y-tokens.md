# ADR-0014: Tiempo real, tokens de API y "ver como cliente"

- **Estado:** aceptada (fase 1)
- **Decisión:**
  - **Tiempo real:** Socket.IO solo por WebSocket en `/socket.io`. La conexión se autentica con la misma cookie de sesión y las mismas reglas de host y `Origin` que HTTP. El servidor solo une el socket a salas permitidas (usuario, grupos con acceso, organización si el cliente tiene ese permiso) y emite eventos **mínimos** (`{type, ticketId}`); el navegador recarga los datos por la API, que vuelve a aplicar la política. Las notas internas no se anuncian a clientes. Las sesiones se revalidan cada minuto. Los eventos viajan por Redis (`mesa:events`) para incluir los del proceso `jobs`. La presencia (quién ve o escribe en un ticket) es solo para agentes.
  - **Tokens de API:** personales, solo para personal y solo en el host de agentes; se muestran una vez y se guarda el hash; expiración obligatoria (≤ 365 días), *scopes* = permisos del usuario que el token conserva; nunca satisfacen la reautenticación. Creación y revocación auditadas.
  - **Ver como cliente:** solo administradores, con motivo y reautenticación, 15 minutos, solo lectura (únicamente rutas GET que reutilizan la política del cliente), con aviso visible y registro en la bitácora.
