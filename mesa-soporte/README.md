# Mesa de soporte de Inncentives

Help desk inspirado en Zammad para los administradores de clientes de Inncentives. **Estado: fase 0 (cimientos) terminada**; ver `docs/fases/fase-0.md`.

| Directorio | Contenido |
|---|---|
| `packages/shared` | Esquemas Zod, permisos por rol y tipos compartidos API/web |
| `apps/api` | API NestJS/Fastify: autenticación, MFA, sesiones, autorización, auditoría, invitaciones, almacenamiento |
| `apps/worker` | Worker BullMQ: envío de correo |
| `apps/web` | SPA React (portal de clientes y área de agentes, es/en) |
| `docker/` | Dockerfile multi-target (distroless), PostgreSQL + pgBackRest, nginx (web) |
| `deploy/` | Compose de producción, scripts de operación, systemd y pruebas de operación |
| `infra/` | Terraform para OCI (Querétaro), cloud-init, alta de secretos en Vault |
| `docs/` | ADRs, seguridad, despliegue, runbooks, progreso |

## Desarrollo local

Requisitos: Node 22, pnpm 10 y Docker.

```bash
docker compose up -d                 # PostgreSQL, Redis, S3 (SeaweedFS), Mailpit
cp .env.example .env                 # y genera SECRET_FIELD_ENCRYPTION_KEYS
pnpm install
pnpm --filter @mesa/shared build
pnpm db:migrate && pnpm db:seed      # usuarios demo (contraseña en SEED_PASSWORD o impresa)
pnpm --filter @mesa/api dev          # http://127.0.0.1:3000
pnpm --filter @mesa/worker dev
pnpm --filter @mesa/web dev          # http://soporte.localhost:5173 y http://agentes.soporte.localhost:5173
```

Los correos llegan a Mailpit: http://127.0.0.1:8025.

## Pruebas

```bash
pnpm lint && pnpm typecheck && pnpm test     # estáticas + unitarias
pnpm test:int                                # integración (PostgreSQL + Redis + S3 reales)
pnpm test:e2e                                # navegador (Playwright)
deploy/tests/deployer.test.sh                # desplegador (firmas, reversión)
deploy/tests/secrets-sync.test.sh            # secretos desde Vault
sudo -E deploy/tests/backup-restore.test.sh  # respaldo + PITR + volcado cifrado
sudo -E deploy/tests/prod-stack.smoke.sh     # stack de producción endurecido
```

Las pruebas de integración y E2E crean una base de datos propia y la eliminan al terminar; nunca tocan una existente.

## Producción

Ver `docs/despliegue.md` (OCI Querétaro + Cloudflare) y `docs/runbooks/`.
