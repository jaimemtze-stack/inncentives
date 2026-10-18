# Modelo de amenazas (STRIDE) — fases 0 y 1

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

### Amenazas agregadas en la fase 1

| # | STRIDE | Amenaza | Mitigación (dónde) | Verificación |
|---|---|---|---|---|
| 23 | S | Correo que suplanta a un cliente para leer o inyectar en sus tickets | Solo se confía en `Authentication-Results` del servidor configurado; sin `pass` → "Por verificar" sin cliente ni respuesta automática; seguimiento solo si el remitente pertenece al ticket | `mail-rules.test.ts`, `email.int.test.ts` |
| 24 | S | Webhook CTI falsificado o repetido | HMAC sobre el cuerpo exacto + marca de tiempo (5 min) + firma de un solo uso en Redis | `phone.test.ts`, `attachments.int.test.ts` |
| 25 | T | Bucles de correo o de triggers | `X-Loop`, detección de automáticos y rebotes, límite por cliente/hora, trigger una vez por cadena y profundidad 3, advertencia al guardar | `email.int.test.ts`, `tickets.int.test.ts`, `config-admin.int.test.ts` |
| 26 | T | Reglas que ejecutan código o consultas arbitrarias | Reglas como datos validados contra un catálogo cerrado (ADR-0011) | `conditions.test.ts`, `config-admin.int.test.ts` |
| 27 | I | Notas internas o datos internos vistos por clientes (API, búsqueda, tiempo real, adjuntos) | DTOs por rol; búsqueda excluye notas internas para clientes; eventos sin datos y sin notas internas; adjuntos de notas internas → 404 | `tickets.int.test.ts`, `realtime.int.test.ts`, `attachments.int.test.ts` |
| 28 | I | IDOR de tickets entre grupos u organizaciones | `TicketAccessService.scope` en toda consulta; fuera de alcance = 404 | `tickets.int.test.ts` |
| 29 | I | Exposición de datos de nómina (RFC, CURP, NSS, CLABE, sueldos) | Detector en artículos y adjuntos, aviso previo al cliente, bandera, redacción y borrado auditados, retención | `sensitive.test.ts`, `attachments.int.test.ts`, `jobs.int.test.ts` |
| 30 | T/E | Malware o XSS en adjuntos | Lista blanca + *magic bytes*, sin SVG/HTML, ClamAV antes de descargar, descarga desde el dominio del almacenamiento, imágenes recodificadas | `sniff.test.ts`, `jobs.int.test.ts` |
| 31 | I | Rastreo con imágenes remotas en correos | Bloqueadas por defecto (`data-remote-src`), carga solo a petición | `sanitize.test.ts` |
| 32 | E | SSRF desde webhooks | Solo HTTPS; resolución DNS validada contra rangos privados, *loopback*, metadatos y reservados; conexión fijada a la IP validada; sin redirecciones | `safe-fetch.test.ts` |
| 33 | E | Token de API robado | Solo hash, expiración obligatoria, *scopes*, solo host de agentes, sin reautenticación, revocable, auditado | `config-admin.int.test.ts` |
| 34 | E | Abuso de "ver como cliente" | Solo admins, motivo + reautenticación, 15 min, solo lectura, auditado | `config-admin.int.test.ts` |

### Amenazas agregadas en la fase 2

| # | STRIDE | Amenaza | Mitigación (dónde) | Verificación |
|---|---|---|---|---|
| 35 | S | Toma de cuenta por SSO (IdP mal configurado, correo coincidente, cuenta nueva en el tenant) | Sin aprovisionamiento ni vinculación por correo; solo identidades `issuer`+`sub` vinculadas por el propio usuario con reautenticación; MFA propio salvo `trustIdpMfa` + `amr: mfa` | `sso.int.test.ts` |
| 36 | S/T | Respuesta OIDC manipulada o repetida (CSRF de login, `code` robado, token de otra aplicación) | PKCE S256, `state` y `nonce` de un solo uso (GETDEL en Redis, 10 min), firma por JWKS, `iss`/`aud`/algoritmos verificados, proveedor ligado al área del host | `sso.int.test.ts` |
| 37 | S | Passkey clonada o registrada en el host equivocado | RP ID = host del área, origen esperado, reto por sesión de 5 min, contador de firmas | `e2e/webauthn.spec.ts` |
| 38 | I | Respuestas internas de la base de conocimiento vistas por clientes | Filtro de audiencia en el servidor en lista, detalle, búsqueda y sugerencias; 404 fuera de alcance | `kb.int.test.ts` |
| 39 | T | Inyección de fórmulas en exportaciones CSV/XLSX | Prefijo `'` para `= + - @ \t \r`; XLSX con celdas de texto (`inlineStr`) | `export.test.ts` |
| 40 | I | Exportación masiva de datos por un agente | Mismo alcance que las vistas; periodo ≤ 400 días; cada exportación auditada con filtros y número de filas | `reports.int.test.ts` |
| 41 | S/T | *Service hook* de Azure DevOps falsificado | *Basic auth* con secreto propio (tiempo constante); el cuerpo no se usa salvo el id: el estado se vuelve a leer con el PAT | `integrations.int.test.ts` |
| 42 | I | Contenido de clientes enviado a Teams o URL del webhook filtrada | Tarjetas con metadatos solamente; URL cifrada con AAD por canal, de solo escritura, hosts de Microsoft en lista blanca | `integrations.int.test.ts`, `teams.test.ts` |
| 43 | E | PAT de Azure DevOps con demasiado alcance | Alcance *Work Items* únicamente, cuenta de servicio, secreto en Vault y caducidad ≤ 1 año | `despliegue.md` |
| 44 | T/E | Importación CSV que crea cuentas o eleva privilegios | Solo invitaciones (no cuentas); rol validado contra el permiso de quien importa; validación completa antes de escribir (todo o nada); tamaño y filas acotados; auditado | `import.int.test.ts`, `csv.test.ts` |
| 45 | I | Búsqueda global que enumera personas u organizaciones | Usuarios y organizaciones solo para personal y con `userScope`/`organizationScope`; tickets con `scope('read')` | `search.int.test.ts` |

## Riesgos residuales aceptados (fase 0)

- **TLS interno:** el TLS hacia PostgreSQL dentro de la red Docker usa un certificado autofirmado sin verificación (`sslaccept=accept_invalid_certs`). Protege contra captura pasiva; la red es interna.
- **Llave de larga duración:** la *Customer Secret Key* de pgBackRest es la única llave de larga duración. Está acotada a un bucket y se rota cada 90 días.
- **Un solo servidor sin alta disponibilidad:** el RTO de ≤ 4 h depende de Terraform + cloud-init + restauración.
- **Reportes de vulnerabilidad:** el canal de `SECURITY.md` usa un buzón provisional hasta que Neitek defina uno.

## Riesgos residuales aceptados (fase 1)

- **Detector de datos sensibles por patrones:** puede tener falsos negativos (datos sin formato estándar) y falsos positivos; es un apoyo, no un control de prevención de fugas.
- **Imágenes remotas:** la CSP permite `img-src https:` para que funcione "Mostrar imágenes"; la carga siempre requiere una acción del agente.
- **Webhook de telefonía:** público en el host del portal (los proveedores no pasan por Cloudflare Access); se protege solo con HMAC, marca de tiempo y anti-repetición.

## Riesgos residuales aceptados (fase 2)

- **`trustIdpMfa`:** si se activa, la fortaleza del segundo factor depende del Acceso condicional de Entra; por defecto está desactivado.
- **Sincronización de DevOps:** sin *service hook*, el estado se actualiza cada 15 minutos.
- **DAST:** ZAP *baseline* (pasivo + *spider*) en el CI contra el stack de producción local; no sustituye una prueba de penetración autenticada antes de abrir el portal a clientes.
