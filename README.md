# Soporte Inncentives

Mesa de soporte (help desk) para los clientes de **Inncentives**, inspirada en Zammad. Monorepo TypeScript.

| Paquete | Descripción |
|---|---|
| `apps/api` | API NestJS + Fastify (`/api/v1`), PostgreSQL (Prisma), Redis |
| `apps/worker` | Jobs BullMQ (correo, y en fase 1: SLA, escaneo, retención) |
| `apps/web` | SPA React (portal de clientes y área de agentes en hosts distintos) |
| `packages/shared` | Dominio puro compartido: calendario laboral MX, SLA, detector de datos sensibles, esquemas Zod |
| `e2e` | Pruebas Playwright contra el stack en ejecución |

## Inicio rápido

```bash
pnpm install
cp .env.example .env    # completa FIELD_ENCRYPTION_KEYS, CSRF_SECRET y SEED_DEMO_PASSWORD
docker compose up -d postgres redis mailpit
pnpm --filter @inn/api prisma:migrate:deploy
pnpm --filter @inn/api seed
pnpm dev                # API :3000 · web http://localhost:5173 (portal) · http://agents.localhost:5173 (agentes)
```

Pruebas: `pnpm test` (requiere Postgres y Redis; ver `TEST_DATABASE_URL`/`TEST_REDIS_URL`), `pnpm --filter @inn/e2e e2e` con el stack levantado.

## Documentación

- Avance: [`docs/PROGRESO.md`](docs/PROGRESO.md)
- Decisiones: [`docs/decisiones/`](docs/decisiones/README.md)
- Seguridad: [`docs/seguridad/`](docs/seguridad/) · [`SECURITY.md`](SECURITY.md)
- Despliegue: [`docs/despliegue.md`](docs/despliegue.md)
