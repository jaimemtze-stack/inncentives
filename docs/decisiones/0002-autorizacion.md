# ADR-0002: Autorización — denegar por defecto y *policy service* único

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
La fuga más probable en una mesa de soporte multicliente es el acceso cruzado entre organizaciones (IDOR) y la exposición de notas internas a clientes. Zammad resuelve esto con permisos por grupo para agentes y por organización para clientes.

## Decisión
1. **Guard global** (`PermissionGuard`) registrado como `APP_GUARD`. Toda ruta debe declarar `@RequirePermission(...)` o `@Public()`. Una ruta sin declaración responde **403** y una prueba automatizada recorre todas las rutas registradas y falla si alguna no declara su política.
2. **Permisos** con nombres jerárquicos al estilo Zammad (`admin.*`, `ticket.agent`, `ticket.customer`, `user_preferences.*`). Los roles `admin`, `agent`, `customer` vienen predefinidos; se permiten roles personalizados.
3. **Nivel de objeto:** un único `PolicyService` produce **filtros de consulta** (`Prisma.TicketWhereInput`) a partir del actor:
   - Cliente: `customerId = actor` **o** `organizationId ∈ organizaciones autorizadas` si tiene `shared_organization`.
   - Agente: `groupId ∈ grupos con nivel ≥ requerido` (`read`, `create`, `change`, `overview`, `full`).
   - Admin sin acceso de agente **no** ve tickets por ser admin; los permisos de ticket son explícitos.
   Vistas, búsqueda, reportes, exportaciones, adjuntos, tiempo real y webhooks deben usar ese filtro; no se permite construir filtros de acceso fuera del servicio.
4. **DTOs por rol:** las respuestas para clientes se construyen con serializadores que **omiten** artículos `internal`, campos internos, tiempo contabilizado y metadatos internos. No se "ocultan" en el frontend.
5. **Separación de hosts:** el portal y el área de agentes/admin se sirven en hosts distintos; un `HostGuard` hace que los endpoints de agente/admin solo respondan en su host configurado.

## Alternativas
- **CASL/Casbin:** expresivos pero duplican la lógica de filtros en consultas; el filtro como `WhereInput` es más difícil de olvidar.
- **Row Level Security en PostgreSQL:** defensa en profundidad atractiva; se evaluará en fase 2 (requiere pasar el actor por `SET LOCAL` en cada transacción con Prisma).

## Consecuencias
- Cada endpoint nuevo requiere su caso en la matriz de autorización (sección 8).
- La prueba de rutas evita que se olvide declarar permisos.
