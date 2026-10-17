# ADR-0002: Autorización "denegar por defecto" y política única

- **Estado:** aceptada
- **Decisión:**
  - Un guard global (`AuthzGuard`) rechaza cualquier ruta que no declare `@Public()` o `@RequirePermissions(...)`. Una prueba de integración recorre todas las rutas registradas y falla si alguna no tiene metadatos.
  - Permisos por rol en `packages/shared/src/permissions.ts` (ADMIN, AGENT, CUSTOMER), compartidos con la web.
  - Autorización a nivel de objeto en `PolicyService` (`userScope`, `organizationScope`, `canInvite`). Toda consulta de listados usa estos filtros: un recurso fuera de alcance responde 404, sin revelar si existe.
  - El área (portal o agentes) se decide por el encabezado `Host`. La sesión queda ligada al área y al rol, y las rutas de administración están fijadas con `@Area('agent')`.
  - Los DTO usan *allow-lists* explícitas (`select`), nunca el modelo completo, y los esquemas Zod son `.strict()` (contra asignación masiva).
- **Consecuencias:** agregar un endpoint sin decorar falla en CI. Los roles personalizados de la fase 1 extenderán `RolePermissions` sin cambiar el guard.
