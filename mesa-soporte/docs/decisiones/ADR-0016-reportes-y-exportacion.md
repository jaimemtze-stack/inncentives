# ADR-0016: Reportes, tablero y exportación

- **Estado:** aceptada (fase 2)
- **Decisión:**
  - Los reportes se calculan **en línea** sobre PostgreSQL con el mismo alcance de lectura que vistas y búsqueda (`TicketAccessService.scope('read')`); periodo máximo 400 días y tope de 50 000 filas por consulta. Sin almacén analítico mientras el volumen lo permita (decenas de miles de tickets).
  - Métricas: creados, cerrados, abiertos, reaperturas (historial de estado), primera respuesta y solución (promedio, mediana, p90 en minutos de reloj), cumplimiento de SLA (eventos `sla_breach` registrados por `jobs`), carga por agente y grupo, **tiempo por organización contra los minutos incluidos en su plan**, módulos y categorías más frecuentes.
  - Exportación CSV (UTF-8 con BOM, para Excel) y XLSX (OOXML mínimo propio, sin dependencias). **Protección contra inyección de fórmulas:** toda celda de texto que empiece con `=`, `+`, `-`, `@`, tabulador o retorno se antepone con `'`. Cada exportación queda en la bitácora (`report.exported`) con formato, filas y filtros.
  - Permiso `reports.read` (agentes y administradores). El tablero usa la paleta validada para daltonismo, leyenda + etiquetas directas, *crosshair* y vista de tabla.
- **Consecuencias:** sin dependencia de una librería XLSX (superficie menor); si el volumen crece, se pasaría a vistas materializadas refrescadas por `jobs`.
