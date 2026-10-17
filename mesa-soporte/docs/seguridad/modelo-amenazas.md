# Modelo de amenazas (STRIDE) — fase 0

Alcance: la plataforma base (autenticación, sesiones, autorización, auditoría y correo), la infraestructura en OCI y la cadena de entrega. Se revisará al cerrar cada fase.

## Activos

| Activo | Por qué importa |
|---|---|
| Datos de clientes (usuarios, organizaciones; tickets y adjuntos desde la fase 1) | Datos personales (LFPDPPP/GDPR); los adjuntos pueden contener nómina |
| Credenciales y sesiones | Acceso a todo lo anterior |
| Semillas TOTP y códigos de recuperación | Segundo factor |
| Bitácora de auditoría | Evidencia (ISO 27001) |
| Respaldos | Recuperación y, mal protegidos, fuga masiva |
| Secretos de infraestructura (Vault, tokens) | Toma de control |
| Cadena de entrega (repo, CI, imágenes) | Código malicioso en producción |

## Fronteras de confianza

```
Internet ─▶ Cloudflare (WAF/Access) ─▶ Tunnel ─▶ nginx ─▶ API ─▶ PostgreSQL / Redis
                                                  │          └▶ Worker ─▶ SMTP/Graph
GitHub Actions ─(release firmado)─▶ deployer (pull) en la VM ─▶ Docker
Operador ─▶ Cloudflare Access SSH / OCI Bastion ─▶ VM        VM ─▶ OCI Vault / Object Storage (instance principal)
```

## Amenazas y mitigaciones

| # | STRIDE | Amenaza | Mitigación (dónde) | Verificación |
|---|---|---|---|---|
| 1 | S | Robo de contraseña / *credential stuffing* | Argon2id; HIBP k-anonymity; bloqueo progresivo por cuenta e IP; MFA obligatorio para personal | `auth.int.test.ts` (bloqueo), `crypto.test.ts` |
| 2 | S | Phishing de agentes | Host de agentes detrás de Cloudflare Access + Entra ID (MFA/Acceso Condicional) **y** login propio con TOTP | Configuración Cloudflare (`despliegue.md`) |
| 3 | S | Fijación o robo de sesión | Token de 256 bits, solo hash en Redis, `__Host-` + `HttpOnly` + `Secure`, rotación en MFA y cambio de contraseña, expiración por inactividad y absoluta | `auth.int.test.ts`, E2E (cookie no accesible a JS) |
| 4 | S | Reutilización de un código TOTP | Marca por usuario y ventana en Redis (`SET NX`) | `auth.int.test.ts` (replay rechazado) |
| 5 | S | Suplantación de IP en registros y *rate limiting* | `CF-Connecting-IP` solo si llega por el proxy de confianza; `trustProxy` limitado a nginx | `platform.int.test.ts`, *smoke* de producción |
| 6 | T | CSRF | `Origin`/`Sec-Fetch-Site` exactos + token por sesión + `SameSite=Lax` | `platform.int.test.ts`, `auth.int.test.ts` |
| 7 | T | Asignación masiva / entrada malformada | Zod `.strict()` en todas las entradas, *pipes* por ruta | `admin.int.test.ts` |
| 8 | T | Alteración de la bitácora | Disparador que bloquea UPDATE/DELETE/TRUNCATE; rol `app_rw` sin esos privilegios; cadena de hash verificable | `admin.int.test.ts`, *smoke* de producción |
| 9 | T | Imagen o despliegue manipulado | Firmas cosign *keyless* verificadas contra el workflow exacto en `main`; *digests* obligatorios; aprobación manual | `deployer.test.sh` |
| 10 | R | Acciones sin rastro | Auditoría de logins, MFA, invitaciones, revocaciones y verificación; OCI Audit para el plano de control | `admin.int.test.ts` |
| 11 | I | Enumeración de cuentas | Mismo error y tiempo para correo inexistente, contraseña mala o área equivocada; "olvidé mi contraseña" siempre 202 | `auth.int.test.ts` |
| 12 | I | IDOR (sesiones, usuarios, organizaciones, invitaciones) | `PolicyService` en cada consulta; fuera de alcance = 404 | `auth.int.test.ts`, `admin.int.test.ts` |
| 13 | I | Fuga de secretos en logs, errores o env | Redacción de pino; errores sin valores; secretos solo en archivos `0400` sobre tmpfs; nada en el estado de Terraform | Pruebas de validación, *smoke* (sin URL de BD en env) |
| 14 | I | Fuga desde respaldos | pgBackRest cifrado del lado del cliente; volcados con `age` (llave privada fuera del servidor); buckets privados cifrados con KMS | `backup-restore.test.sh` |
| 15 | I | Tokens de un solo uso en logs o `Referer` | Token en el fragmento `#`, eliminado del historial; solo el hash en la BD | `api.test.ts` (web), `auth.int.test.ts` |
| 16 | I | XSS en la web | CSP estricta sin inline (nginx), React escapa, plantillas de correo escapadas | Build sin scripts inline, *smoke* (CSP), `templates.test.ts` |
| 17 | D | Abuso / fuerza bruta | WAF y *rate limiting* de Cloudflare + limitadores en Redis; límite de cuerpo 1 MB; límites de memoria y PIDs por contenedor | Pruebas de bloqueo |
| 18 | D | Llenado de disco o memoria | Alarmas OCI (disco > 85 %, memoria > 90 %, *heartbeat* ausente); rotación de logs de Docker | Terraform (`observability.tf`) |
| 19 | E | Escalada dentro de contenedores | No-root, sistema de archivos de solo lectura, `cap_drop: ALL`, `no-new-privileges`, distroless | *smoke* de producción |
| 20 | E | Movimiento lateral en la red | Redes Docker internas por capa (edge / app / data); la BD no tiene salida a Internet; NSG sin entrada | *smoke* de producción |
| 21 | E | Abuso de la identidad de la VM | Políticas IAM acotadas por bucket, permiso y vault; el bucket inmutable solo admite crear | Terraform (`iam.tf`) |
| 22 | E | Agente lee el buzón completo de Neitek | *RBAC for Applications* de Exchange limitado a `soporte@` (fase 1) | `despliegue.md` |

## Riesgos residuales aceptados (fase 0)

- **TLS interno:** el TLS hacia PostgreSQL dentro de la red Docker usa un certificado autofirmado sin verificación (`sslaccept=accept_invalid_certs`). Protege contra captura pasiva; la red es interna.
- **Llave de larga duración:** la *Customer Secret Key* de pgBackRest es la única llave de larga duración. Está acotada a un bucket y se rota cada 90 días.
- **Un solo servidor sin alta disponibilidad:** el RTO de ≤ 4 h depende de Terraform + cloud-init + restauración.
- **Reportes de vulnerabilidad:** el canal de `SECURITY.md` usa un buzón provisional hasta que Neitek defina uno.
