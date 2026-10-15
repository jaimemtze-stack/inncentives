# Fase 0 — Cimientos (resumen)

> Estado: código entregado; pendiente la validación en CI/Compose (ver al final).

## Entregado

| Área | Qué hay | Evidencia |
|---|---|---|
| Monorepo | pnpm workspaces, TS strict, ESLint, Prettier | `pnpm lint`, `pnpm typecheck` |
| Dominio puro | Calendario MX, SLA, detector de datos sensibles, plantillas, CSV, sanitización | 102 pruebas, 97 % de cobertura (`packages/shared`) |
| API | Config/secretos, logger con redacción, errores, cabeceras, rate limit, guard *deny-by-default*, hosts separados, `PolicyService`, auditoría encadenada | 52 pruebas, 92 % de cobertura (`apps/api`) |
| Autenticación | Argon2id + HIBP, bloqueo progresivo, sesiones Redis, CSRF, TOTP + recuperación, invitación, recuperación de contraseña, reautenticación | `test/auth.e2e.spec.ts` (22 casos) |
| Datos | Esquema Prisma del dominio completo, migraciones, `tsvector` es/en, AuditLog append-only | `prisma/migrations`, `test/audit.spec.ts` |
| Worker | Correo transaccional con SMTP/Mailpit y Graph | 4 pruebas |
| Web | Login, MFA, alta de MFA, invitación, recuperación, sesiones; es-MX/en; modo oscuro | 3 pruebas + 4 E2E Playwright |
| Infra | Dockerfile multi-stage no-root, Compose endurecido, CI de seguridad, Dependabot | `.github/workflows/ci.yml` |
| Documentación | ADR 0001–0008, modelo de amenazas, matriz ASVS, respuesta a incidentes, despliegue | `docs/` |

## Cómo verificarlo

```bash
pnpm install
# Postgres 16 y Redis 7 locales (o: docker compose up -d postgres redis)
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/inn_support_test pnpm test
```

## Lo que quedó fuera (y por qué)

- **Docker/Compose:** validado con Docker real (stack completo + E2E + Trivy). Encontró y corrigió: corepack con llaves vencidas, Prisma sin `libssl` en imágenes *slim*, `conf.d` de nginx no escribible por uid 101, OpenSSL vulnerable en distroless Debian 12 (se pasó a Debian 13) e import de `@nestjs/testing` en código de producción.
- **Playwright en CI:** las pruebas existen y pasan localmente contra la API compilada + Vite; falta orquestarlas en CI con el stack de Compose.
- **Rol de BD separado:** el trigger bloquea UPDATE/DELETE en `audit_logs`, pero en producción el rol de la aplicación no debe ser propietario de las tablas (pendiente de `docs/despliegue.md` y script de aprovisionamiento).
- **Adaptadores de almacenamiento (S3/Azure Blob) y ClamAV:** el contrato está en ADR-0003; la implementación entra con adjuntos en la fase 1.

## Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| HIBP falla abierto si no hay red | Se registra un *warning*; desactivable con `HIBP_ENABLED=false`. |
| `prisma migrate dev` propone borrar `DEFAULT` de columnas generadas | Documentado en `apps/api/prisma/README.md`. |
| Un `dump.rdb` de Redis (datos de prueba efímeros, sin secretos reales) quedó en el historial de un commit intermedio | Retirado y añadido a `.gitignore`; no contiene datos reales. |
| Vite no pre-empaqueta paquetes CJS del workspace por defecto | `optimizeDeps.include: ['@inn/shared']`. |
