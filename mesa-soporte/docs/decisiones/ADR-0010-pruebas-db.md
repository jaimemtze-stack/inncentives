# ADR-0010: Bases de datos efímeras para pruebas

- **Estado:** aceptada
- **Contexto:** Prisma bloquea `migrate reset` cuando lo ejecuta un agente de IA, porque destruye datos. No se debe eludir ese bloqueo.
- **Decisión:**
  - Las pruebas de integración y E2E **crean su propia base** con nombre único (`mesa_test_<ts>_<hex>` / `mesa_e2e_…`) y aplican las migraciones con `migrate deploy`, que no es destructivo.
  - Al terminar eliminan **solo esa base**; el script valida el patrón del nombre antes de borrarla.
- **Consecuencias:** nunca se toca una base existente. Las pruebas pueden correr en paralelo con el entorno de desarrollo sobre el mismo servidor PostgreSQL.
