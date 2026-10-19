# ADR-0022: IA para agentes (sección 5.12)

- **Estado:** aceptada como mecanismo **desactivado**; activarla requiere la aprobación de Neitek (pendiente 10).
- **Decisión:**
  - Funciones: resumen del ticket, sugerencia de respuesta basada en la base de conocimiento (solo respuestas visibles para clientes), clasificación (categoría, módulo, prioridad, con esquema JSON restringido a los valores existentes y validado de nuevo con Zod) y asistente de redacción (corregir, formal, breve, traducir).
  - **Desactivada por defecto** en dos niveles: ajuste global `ai.enabled` y `organizations.ai_enabled` (solo un administrador con `admin.config` lo cambia). Sin la llave `anthropic_api_key`, tampoco funciona.
  - **Proveedor:** Claude (`claude-opus-5-5`, esfuerzo `medium`) por la API de Anthropic con el SDK oficial. La organización de Anthropic debe tener **retención cero** contratada; Anthropic no entrena con datos de la API. Si el modelo declina una solicitud, se reintenta del lado del servidor con el modelo de respaldo recomendado (`fallbacks: "default"`); si aun así declina, el agente ve un error, nunca una sugerencia vacía.
  - **Antes de enviar:** el detector de 5.7 más correos, teléfonos, CURP/RFC por forma y rachas largas de dígitos se sustituyen por marcadores. Los adjuntos nunca se envían. El texto de clientes va entre etiquetas y el *prompt* indica tratarlo como datos (defensa contra inyección).
  - **Siempre sugerencia:** el resultado vuelve solo al agente; insertar, aplicar la clasificación o reemplazar el borrador requiere su acción. Nada se envía al cliente automáticamente.
  - Cada solicitud queda en la bitácora (`ai.request`: quién, ticket, propósito, modelo, redacciones, tamaño) y hay un límite de 60 solicitudes por hora por agente.
- **Consecuencias:** costo por uso (estimable con el registro de auditoría). Cambiar a Claude en Microsoft Foundry implicaría otro cliente del SDK sin cambiar las reglas anteriores.
