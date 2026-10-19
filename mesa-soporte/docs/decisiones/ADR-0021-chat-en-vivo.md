# ADR-0021: Chat en vivo

- **Estado:** aceptada (fase 3)
- **Decisión:**
  - Un chat **es un ticket** de canal `chat` y sus mensajes son artículos `chat`. Así reutiliza permisos, historial, búsqueda, SLA, reportes y tiempo real; la tabla `chat_sessions` solo guarda el estado de la cola (`waiting → active → ended`), con a lo más un chat abierto por cliente (índice único parcial).
  - Solo clientes autenticados (portal o ventana abierta desde el widget). El botón de chat aparece solo si hay **agentes disponibles** del grupo de chat: cada agente marca "Disponible" y la interfaz envía un latido cada minuto; el servidor lo olvida a los 90 s.
  - Aceptar es atómico (gana un agente); el agente queda como propietario. Solo el cliente y el agente asignado pueden escribir. Al terminar, un chat atendido se cierra; uno que nadie tomó sigue como ticket normal. `jobs` termina chats inactivos (15 min por defecto).
  - Los avisos por WebSocket solo llevan ids y estado; los mensajes se recargan por la API con su política.
- **Consecuencias:** sin chat anónimo ni bots; el widget abre el chat en la misma ventana del portal.
