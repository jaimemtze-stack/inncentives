# Guía de despliegue

## 1. Local (desarrollo)

Requisitos: Docker con Compose v2, Node 22, pnpm 10.

```bash
cp .env.example .env            # valores de desarrollo, sin secretos reales
pnpm install
docker compose up -d postgres redis minio clamav mailpit
pnpm --filter @inn/api prisma:migrate:deploy
pnpm --filter @inn/api seed
pnpm dev                         # api :3000, web :5173, worker
```

O todo en contenedores:

```bash
docker compose --profile app up --build
```

Servicios locales:

| Servicio | URL |
|---|---|
| Portal (web) | http://localhost:5173 |
| API | http://localhost:3000/api/v1 · `/health` · `/ready` |
| Mailpit | http://localhost:8025 |
| MinIO | http://localhost:9001 |

Usuarios de demostración (ficticios; contraseña en `.env.example` → `SEED_DEMO_PASSWORD`): `admin@demo.inncentives.test`, `agente1@demo.inncentives.test`, `cliente@acme.test`.

> En desarrollo las cookies `__Host-` exigen HTTPS; con `COOKIE_SECURE=false` (solo local) se usan nombres sin prefijo.

## 2. Producción: Azure Mexico Central + Cloudflare (ADR-0005)

### 2.1 Recursos
1. Grupo de recursos en **Mexico Central**.
2. VNet con subred para la VM y subred delegada para PostgreSQL Flexible.
3. **VM Linux** Ubuntu 24.04 (2 vCPU, 8 GB, p. ej. `Standard_B2ms`), disco cifrado (SSE con PMK o CMK), **sin IP pública** ni puertos entrantes en el NSG.
4. **Azure Database for PostgreSQL Flexible Server 16**, acceso privado, TLS obligatorio, respaldos automáticos 7–35 días, cifrado en reposo.
   - Si no está disponible en la región: PostgreSQL en contenedor (perfil `db` de Compose) con volumen en disco cifrado y respaldo `pg_dump` cifrado a Blob cada noche.
5. **Storage Account** (Blob) con acceso público deshabilitado, contenedores `attachments`, `mail-raw`, `backups`; *soft delete* y versionado.
6. **Key Vault** con RBAC; **Managed Identity** de la VM con roles `Key Vault Secrets User` y `Storage Blob Data Contributor`.
7. **Cloudflare:** zona del dominio, **Tunnel** (`cloudflared` en la VM), reglas WAF administradas, **Access** con Entra ID para `agentes.soporte.<dominio>` (excepto `/hooks/*`).

### 2.2 Variables principales

| Variable | Ejemplo |
|---|---|
| `PORTAL_HOST` | `soporte.example.mx` |
| `AGENT_HOST` | `agentes.soporte.example.mx` |
| `DATABASE_URL` | por secreto |
| `REDIS_URL` | `redis://redis:6379` |
| `STORAGE_DRIVER` | `azure-blob` |
| `SECRETS_PROVIDER` | `keyvault` |
| `KEYVAULT_URL` | `https://<vault>.vault.azure.net` |
| `MAIL_ADAPTER` | `graph` |
| `FIELD_ENCRYPTION_KEY` | por secreto (32 bytes base64) |

Lista completa en `.env.example`.

### 2.3 Despliegue
```bash
git clone … && cd inncentives
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d
docker compose exec api node dist/prisma/migrate.js   # migraciones
```

### 2.4 Correo (SPF/DKIM/DMARC)
- SPF: `v=spf1 include:spf.protection.outlook.com -all`.
- DKIM: habilitar en Microsoft 365 Defender y publicar los dos CNAME `selector1/selector2`.
- DMARC: `v=DMARC1; p=quarantine; rua=mailto:dmarc@<dominio>; adkim=s; aspf=s` (subir a `p=reject` tras 30 días sin falsos positivos).
- Graph: aplicación de Entra ID con `Mail.ReadWrite` y `Mail.Send` **restringida al buzón de soporte** mediante *Application Access Policy*.

## 3. Respaldos y continuidad
- RPO 24 h / RTO 8 h (ADR-0007).
- PostgreSQL Flexible: respaldo automático + `pg_dump` nocturno cifrado (`age`) a `backups/`.
- Blob: *soft delete* 30 días + replicación GRS opcional.
- Restauración: `scripts/restore.sh` (fase 1) probado trimestralmente; registrar el resultado en `docs/operacion/restauraciones.md`.

## 4. Escalamiento
- Hasta ~5,000 tickets/mes: una VM.
- Siguiente paso: separar `worker` en otra VM o migrar a **Azure Container Apps** (las imágenes ya son compatibles) y Redis a Azure Cache for Redis.

## 5. Alertas básicas
- Azure Monitor: VM caída, disco > 80 %, CPU sostenida > 85 %.
- `/ready` desde Cloudflare Health Checks.
- Métricas del worker: cola de correo con > 50 jobs por > 10 min, fallos de ClamAV.
