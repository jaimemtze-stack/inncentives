# Prisma

- `schema.prisma` modela el dominio (sección 3 del documento de requisitos).
- Prisma no modela triggers ni columnas generadas. Esas piezas viven en migraciones SQL manuales
  (`*_audit_append_only_and_fts`). No editar migraciones aplicadas; crear una nueva.
- Las columnas `search_vector` (`GENERATED ALWAYS ... STORED`) se declaran como
  `Unsupported("tsvector")` y se consultan con `$queryRaw` etiquetado (parametrizado).
- **Limitación conocida:** `prisma migrate dev` detecta las columnas generadas como un `DEFAULT` y
  propone `ALTER COLUMN "search_vector" DROP DEFAULT`. Al crear migraciones nuevas, usar
  `prisma migrate dev --create-only` y **borrar esas líneas** antes de aplicar.
- En producción, el rol de la aplicación debe ser distinto del propietario de las tablas; además del
  trigger, aplicar `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM <rol_app>`.
