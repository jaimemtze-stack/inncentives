# ADR-0001: Stack tecnológico

- **Estado:** aceptada (fase 0)
- **Contexto:** el prompt (sección 2) fija TypeScript de punta a punta; producción corre en ARM64 (OCI Ampere A1) y el equipo prioriza seguridad y bajo costo.
- **Decisión:**
  - Monorepo pnpm: `packages/shared` (Zod + permisos + tipos), `apps/api` (NestJS 11 sobre Fastify 5), `apps/worker` (BullMQ 5 + Nodemailer), `apps/web` (React 18 + Vite 7 + TanStack Router/Query + Tailwind 3 + i18next).
  - PostgreSQL 16 con Prisma 6; Redis 7 para sesiones, colas y limitación de intentos.
  - Versiones mayores conocidas y estables (Nest 11, Prisma 6, Zod 3, TypeScript 5.9, Vitest 3) en lugar de las mayores más recientes, para reducir el riesgo de cambios incompatibles durante la construcción autónoma. Todas fijadas con versión exacta (`save-exact`).
- **Consecuencias:**
  - El API se ejecuta compilado con `tsc`: `tsx`/esbuild no emite los metadatos de decoradores que necesita la inyección de dependencias de Nest.
  - Actualizar a las mayores nuevas (Nest 12, Prisma 7, Zod 4) queda como tarea planificada, con su propio ADR.

## Actualización (cierre de la fase 0)

Trivy encontró vulnerabilidades HIGH/CRITICAL con corrección disponible. Se aplicaron estos cambios:
- Runtime `gcr.io/distroless/nodejs22-debian13` en lugar de `debian12`, que traía `libssl3` sin parche.
- `fastify` 5.12.7 (override; Nest 11.2.7 fijaba 5.11.3).
- `nodemailer` 10.1.2.
- `deepmerge-ts` 8.0.2 (override, vía `@prisma/config`).
- Servidor web **nginx-unprivileged 1.30.6** en lugar de Caddy: la última versión de Caddy (2.11.7) aún incluye CVE HIGH en la biblioteca estándar de Go y en `x/net`.

Las imágenes base se fijan por *digest* y Dependabot las actualiza.
