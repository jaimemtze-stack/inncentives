# Fase 0 — Cimientos: resumen para revisión

**Estado:** terminada; **pendiente de aprobación para iniciar la fase 1**.

## 1. Qué se entregó

| Área | Entregable | Ubicación |
|---|---|---|
| Código base | Monorepo pnpm, TypeScript estricto, ESLint (prohíbe SQL "unsafe"), Prettier | raíz de `mesa-soporte/` |
| Compartido | Esquemas Zod `.strict()`, permisos por rol, tipos de API, cola de correo | `packages/shared` |
| API | NestJS 11 + Fastify 5; módulos de configuración, logs con redacción, errores, auth, MFA, sesiones, políticas, auditoría, administración, almacenamiento y salud | `apps/api` |
| Worker | Envío de correo (BullMQ + SMTP con STARTTLS), plantillas es/en escapadas | `apps/worker` |
| Web | SPA React (portal y agentes): entrar, MFA, alta de MFA con QR, invitación, restablecer, mi cuenta (sesiones, contraseña, códigos), administración básica, bitácora; español e inglés | `apps/web` |
| Contenedores | API/worker/migrador en distroless Debian 13 (uid 65532); web en nginx-unprivileged (uid 101); PostgreSQL 16 + pgBackRest + age (uid 5432). Todo multi-arquitectura y fijado por *digest* | `docker/` |
| Producción | Compose endurecido: solo lectura, sin capabilities, `no-new-privileges`, redes internas por capa, límites de memoria y PIDs, secretos como archivos | `deploy/docker-compose.prod.yml` |
| Operación | Respaldos pgBackRest, volcado inmutable cifrado, restauración sin borrar datos, sincronización de secretos desde Vault, desplegador *pull* con verificación de firmas y reversión, métricas y alertas, unidades systemd | `deploy/scripts`, `deploy/systemd` |
| Infraestructura | Terraform OCI Querétaro: red privada sin entrada, VM A1 *Always Free*, volúmenes y buckets cifrados con HSM, bucket WORM, IAM mínimo, Bastion, Cloud Guard, Security Zone, escaneo de vulnerabilidades, alarmas y presupuesto; cloud-init autocontenido (gzip, 23 KB) | `infra/` |
| CI/CD | CI (calidad, integración + E2E, pruebas de operación, *smoke* arm64, Terraform, gitleaks, Semgrep, `pnpm audit`, Trivy IaC + imágenes) y release (imágenes multi-arch firmadas + aprobación `production`) | `../.github/workflows/mesa-soporte-*.yml` |
| Documentación | 10 ADRs, modelo de amenazas, matriz ASVS, respuesta a incidentes, guía de despliegue, runbooks, `SECURITY.md` | `docs/`, `SECURITY.md` |

## 2. Cómo se validó (ejecutado en este entorno)

| Verificación | Resultado |
|---|---|
| ESLint, Prettier, `tsc` (5 paquetes) | ✅ sin errores |
| Pruebas unitarias | ✅ 42 (shared 8, api 28, worker 3, web 3) |
| Integración con PostgreSQL + Redis + S3 reales | ✅ 32: denegar por defecto en **todas** las rutas, host desconocido 421, encabezados, CSRF, MFA (incl. anti-repetición), bloqueo de cuenta, IDOR de sesiones, invitaciones, restablecimiento, alcances por rol, bitácora inmutable y verificable, almacenamiento S3, primer admin |
| E2E en Chromium (Playwright) | ✅ 3: alta de MFA y códigos, cookie HttpOnly por host, verificación de bitácora, separación portal/agentes, inglés |
| Flujo real de correo (API → Redis → worker → SMTP → Mailpit) | ✅ enlace con token en el fragmento |
| `backup-restore.test.sh` | ✅ respaldo completo + WAL cifrados a S3 con TLS, borrado "accidental", PITR exacto (500 filas antes / 0 después), volcado `age` ilegible sin llave, restauración en base nueva, se niega a sobrescribir |
| `deployer.test.sh` / `secrets-sync.test.sh` | ✅ firmas obligatorias, *digests*, reversión automática, *tmpfs*, permisos 0400 |
| `prod-stack.smoke.sh` (compose de producción con imágenes reales) | ✅ amd64 (ver §5 para arm64): CSP/HSTS, IP del cliente desde Cloudflare, aislamiento de redes, no-root/solo lectura/sin capabilities, sin secretos en el entorno, `app_rw` sin DDL ni UPDATE/DELETE en la bitácora |
| Terraform `fmt` + `validate` (proveedor oracle/oci 9.10) | ✅ |
| actionlint, shellcheck | ✅ |
| gitleaks (historial y árbol) | ✅ sin fugas |
| Trivy IaC/Dockerfiles | ✅ 0 HIGH/CRITICAL |
| Trivy imágenes (5) | ✅ 0 HIGH/CRITICAL corregibles (tras las correcciones de §3) |
| `pnpm audit --prod` | ✅ sin vulnerabilidades conocidas |
| Semgrep (reglas comunitarias, sin conexión) | ✅ 0 de severidad ERROR (ver §3) |

## 3. Problemas reales encontrados por las pruebas y corregidos

1. **Caddy no arrancaba endurecido:** su binario trae una capability de archivo incompatible con `no-new-privileges`. Más tarde se sustituyó por nginx-unprivileged, por CVE de Go aún sin corregir en Caddy.
2. **El migrador no traía el motor de Prisma** de la plataforma correcta; ahora lo incluye por arquitectura.
3. **La API se caía** si la identidad de instancia de OCI no estaba lista; ahora el cliente de Object Storage se crea en el primer uso.
4. **AES-GCM aceptaba etiquetas truncadas** (Semgrep); ahora exige 16 bytes.
5. **PostgreSQL arrancaba como root** (Trivy); ahora corre como uid 5432 con sistema de archivos de solo lectura.
6. **Vulnerabilidades en dependencias e imágenes base:** se cambió a distroless Debian 13 y se actualizaron fastify, nodemailer y deepmerge-ts.
7. **pgBackRest leía variables `PGBACKREST_*`** del entorno como opciones propias; se renombraron.

## 4. Decisiones tomadas sin consulta (con ADR)

- **SeaweedFS en lugar de MinIO** para desarrollo y CI: MinIO dejó de publicar imágenes (ADR-0004).
- **Versiones mayores conocidas** (Nest 11, Prisma 6, Zod 3, TS 5.9), no las más recientes (ADR-0001).
- **Bases de datos efímeras en las pruebas:** Prisma bloquea con razón `migrate reset` ejecutado por un agente y no se eludió (ADR-0010).
- **Release `mesa-v*` en el mismo repositorio, con aprobación del entorno `production`:** el repositorio es compartido con otros proyectos, por eso el prefijo (ADR-0008).

## 5. Riesgos y pendientes

| # | Tema | Acción requerida | Quién |
|---|---|---|---|
| 1 | **Prueba de humo arm64:** las imágenes compilan para arm64 bajo QEMU; el resultado de la prueba de humo con esas imágenes se anota abajo. En CI corre en cada *push* a `main` | Revisar el primer run del workflow | Neitek |
| 2 | **Nada se ha aplicado en OCI ni en Cloudflare:** Claude Code no tiene credenciales, por diseño | Seguir `docs/despliegue.md` | Infra Neitek |
| 3 | **El CI no ha corrido en GitHub todavía:** cada componente se validó localmente, pero las versiones de las acciones (v7, v8…) son más nuevas que las conocidas | Revisar el primer run y ajustar entradas si alguna acción cambió | Neitek / fase 1 |
| 4 | **TLS hacia PostgreSQL sin verificación de certificado**, dentro de la red Docker interna | Aceptado; mejorar con una CA propia | Fase 2 |
| 5 | **Correo por SMTP en la fase 0;** Graph con RBAC for Applications llega en la fase 1 | — | Fase 1 |
| 6 | **Buzón de `SECURITY.md` provisional** | Definir el buzón real | Neitek |
| 7 | **Retención de datos e ISO 27001** sin definir (decisión pendiente 9) | Definir plazos | Neitek |
| 8 | **Primera prueba de restauración en OCI y bloqueo WORM** | Pasos de `despliegue.md` §10 | Infra Neitek |

## 6. Cómo revisarlo rápido

```bash
cd mesa-soporte
docker compose up -d && cp .env.example .env   # generar SECRET_FIELD_ENCRYPTION_KEYS
pnpm install && pnpm --filter @mesa/shared build && pnpm db:migrate && pnpm db:seed
pnpm --filter @mesa/api dev & pnpm --filter @mesa/worker dev & pnpm --filter @mesa/web dev
# http://agentes.soporte.localhost:5173 (admin@neitek.example) y http://soporte.localhost:5173 (cliente@acme.example)
```
