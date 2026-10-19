# ADR-0011: Reglas como datos (triggers, planificadores, SLAs, vistas, Core Workflows)

- **Estado:** aceptada (fase 1)
- **Contexto:** Zammad permite que los administradores definan condiciones y acciones. Un lenguaje de expresiones o código configurable abriría la puerta a inyección y a consultas costosas.
- **Decisión:**
  - Las condiciones son **JSON validado** contra un catálogo cerrado de campos y operadores (`packages/shared/src/conditions.ts`): máximo 60 nodos y 4 niveles. Los campos "consultables" se traducen a filtros de Prisma (vistas, planificadores); los de evento (`article.*`, `changed`, `changed_to`) solo se evalúan en memoria (triggers).
  - Las acciones son una unión discriminada de Zod (`set`, `set_custom`, `add_tags`, `remove_tags`, `notify`, `add_note`, `reply_customer`, `webhook`). No existe una acción que ejecute código.
  - Las plantillas de texto (`{{ticket.number}}`…) usan una **lista blanca** de variables, sin expresiones; los valores se escapan cuando el destino es HTML.
  - **Bucles:** cada trigger se ejecuta como máximo una vez por cadena y la profundidad está limitada a 3. Al guardar, la API advierte (`loop_risk:*`) cuando un trigger cambia un campo que sus propias condiciones observan. Las respuestas automáticas tienen un límite por cliente y hora, nunca responden a correo automático (`Auto-Submitted`, `Precedence`, listas, rebotes) ni a remitentes sin verificar.
  - **Core Workflows** se evalúan en el navegador como ayuda y **se vuelven a aplicar en el servidor** en cada alta y cambio (obligatorio, solo lectura, opciones permitidas).
- **Consecuencias:** las reglas se pueden revisar, exportar y probar; agregar un campo nuevo requiere tocar el catálogo (cambio de código revisado).
