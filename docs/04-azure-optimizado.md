# Opción "Azure optimizado": detalle completo

> Documento de análisis. **Todavía no se aplica al prompt de construcción** (`02-prompt-mesa-soporte.md`).
> Precios de referencia en USD/mes, octubre de 2026, región Mexico Central, sin impuestos. Son estimaciones a partir de rastreadores de terceros: confírmalas en la [calculadora de Azure](https://azure.microsoft.com/pricing/calculator/) antes de contratar.

## 1. Resumen

| Concepto | Valor |
|---|---|
| Costo base | **~$50–60/mes** con reserva de 3 años |
| Con Cloudflare Pro (recomendado) | ~$70–85/mes |
| Con un entorno de *staging* que se enciende solo cuando se usa | +$5–10/mes |
| Datos | En México (Mexico Central) |
| RPO (pérdida máxima de datos) | ~1–5 minutos |
| RTO (tiempo para volver a operar) | ~2–4 horas |
| Diferencia con la opción A original | PostgreSQL corre en el servidor (Neitek lo opera), reserva de 3 años en vez de pago por uso, y sin Azure Backup de la VM (se reconstruye con código) |
| Lo que **no** cambia | Todos los controles de acceso y seguridad de `03-despliegue-hosting.md`, sección 4 |

## 2. Arquitectura

```
 soporte.inncentives.com (clientes)        agentes.soporte.inncentives.com (Neitek)
              │                                          │
              ▼                                          ▼
 ┌──────────────────────────────── Cloudflare ─────────────────────────────────┐
 │ DNS · TLS 1.2+ · HSTS · WAF (reglas OWASP) · DDoS · rate limiting · bots      │
 │ Access: host de agentes y SSH → Entra ID (MFA + Acceso Condicional)           │
 └───────────────────────────────────┬─────────────────────────────────────────┘
                                     │ Cloudflare Tunnel (solo conexión saliente)
 ┌──────────── Suscripción Azure dedicada · Mexico Central ─────────────────────┐
 │ rg-soporte-prod                                                               │
 │  VNet 10.40.0.0/24 · NSG: entrada DENY ALL desde Internet                     │
 │  ┌──────────── VM B2as_v2 · Ubuntu 24.04 LTS · Trusted Launch ────────────┐   │
 │  │ cloudflared · caddy · web · api · worker · redis · clamav · postgres    │   │
 │  │ pgbackrest (WAL continuo)                                              │   │
 │  │ Disco SO: Standard SSD 32 GB   Disco datos: Premium SSD 64 GB (PG)     │   │
 │  │ Cifrado en host · Managed Identity · agente de Defender y Azure Monitor │   │
 │  └──────┬──────────────────────┬──────────────────────┬───────────────────┘   │
 │         │ Private Endpoint     │ Private Endpoint     │ Private Endpoint      │
 │   Key Vault              st-adjuntos (Blob)      st-respaldos (Blob)          │
 │   (secretos,             adjuntos de tickets     pgBackRest repo1 + repo2     │
 │    certificados)         versionado              versionado + WORM por versión│
 │                                                  geo-redundante (GRS)         │
 │  Log Analytics · Defender for Cloud · Azure Policy · alertas → Teams         │
 └──────────────────────────────────────────────────────────────────────────────┘
          │ Salida: Graph (buzón soporte@), Azure DevOps, Teams, actualizaciones
```

> Los *Private Endpoints* cuestan ~$7–8/mes cada uno. Para no pagarlos, se usa en su lugar el **firewall de servicio con la regla de "Service Endpoint" de la VNet**: Key Vault y las cuentas de Storage solo aceptan tráfico de la subred de la VM, sin costo adicional. Es la configuración que asume el presupuesto. Si una auditoría exige Private Endpoints, suma ~$22/mes por tres.

## 3. Componentes y costo detallado

| # | Componente | SKU / configuración | USD/mes aprox. |
|---|---|---|---|
| 1 | Máquina virtual | **B2as_v2** (2 vCPU AMD, 8 GB), Linux, **reserva de 3 años** (pago por uso ~$60) | **~$25–28** |
| 2 | Disco del SO | Standard SSD E4, 32 GB | ~$2.5 |
| 3 | Disco de datos (PostgreSQL) | Premium SSD P6, 64 GB (240 IOPS, *burst* a 3,500) | ~$10 |
| 4 | Snapshots incrementales | Semanales del disco de datos y del SO, 4 semanas | ~$1–3 |
| 5 | IP pública estándar | Solo para tráfico saliente; ningún puerto entrante | ~$3.65 |
| 6 | Storage de adjuntos | Blob Hot, ZRS, versionado + *soft delete* 14 días | ~$1–3 |
| 7 | Storage de respaldos | Blob Cool, GRS (copia en otra región), versionado + WORM por versión | ~$2–5 |
| 8 | Key Vault | Standard, ~decenas de miles de operaciones/mes | <$1 |
| 9 | Log Analytics | 1–3 GB/mes de ingesta, retención 90 días | ~$0–7 |
| 10 | Microsoft Defender for Servers | Plan 1 (EDR + evaluación de vulnerabilidades) | ~$5 |
| 11 | Defender CSPM básico, Azure Policy, Activity Log | Incluidos | $0 |
| 12 | Reglas de alerta de Azure Monitor | ~10 reglas de métricas y logs | ~$1–2 |
| 13 | Cloudflare | Free: Tunnel, Access (≤50 usuarios), DNS, reglas WAF básicas | $0 |
| | **Subtotal base** | | **~$50–60** |
| 14 | Cloudflare Pro (**recomendado**) | WAF con el conjunto de reglas OWASP, más reglas personalizadas | ~$20–25 |
| 15 | Monitoreo externo de disponibilidad | UptimeRobot / Better Stack, nivel gratuito | $0 |
| 16 | Buzón compartido `soporte@` en Microsoft 365 | No requiere licencia | $0 |
| | **Total recomendado** | | **~$70–85** |
| 17 | *Staging* (opcional) | VM B2als_v2 (2 vCPU, 4 GB), encendida solo en pruebas; Storage y Key Vault propios | ~$5–10 |

**Reserva vs. Savings Plan (ítem 1):**

| Modalidad | VM/mes aprox. | Flexibilidad |
|---|---|---|
| Pago por uso | ~$60 | Total |
| Reserva de 1 año | ~$36–40 | Media |
| **Reserva de 3 años** | **~$25–28** | Baja: misma familia y región |
| Savings Plan de 3 años | ~$30–35 | Alta: aplica a cualquier cómputo de Azure |

Notas sobre la reserva:
- Microsoft anunció que las reservas compradas desde el **1 de febrero de 2027** ya no se podrán intercambiar, y que habrá una penalización del 12 % por cancelación anticipada. Si se compra la reserva antes de esa fecha, conserva el derecho de intercambio actual.
- Recomendación: arrancar **3 meses con pago por uso** para medir el uso real (CPU, memoria) y comprar la reserva después. El sobrecosto es de unos $100 en total.
- La serie B es "con ráfagas": tiene un rendimiento base de CPU y acumula créditos para picos. Para esta carga basta. Hay una alerta de créditos bajos (sección 9); si se agotan seguido, se pasa a D2as_v6 (~el doble de precio).

## 4. Red y exposición

| Control | Configuración |
|---|---|
| NSG de la subred y de la NIC | Entrada: **denegar todo** desde Internet (incluido 22/443). Salida: permitir 443 y 53; bloquear el resto (SMTP saliente directo incluido, porque el correo va por Graph). |
| Firewall del host | `ufw default deny incoming`, como segunda capa. |
| Entrada web | Solo por **Cloudflare Tunnel**. `cloudflared` corre como contenedor y su token se lee de Key Vault. Si alguien descubre la IP, no hay nada escuchando. |
| Salida | IP pública estándar en la NIC (las VNets nuevas ya no tienen salida por defecto). Alternativa más cara: NAT Gateway (~$32/mes). |
| Key Vault y Storage | `publicNetworkAccess` restringido: solo la subred de la VM (Service Endpoint) y, para administración, las IPs de la oficina de Neitek. Para Storage, **acceso por clave compartida deshabilitado** (solo Entra ID). |
| DNS | En Cloudflare. CAA que autoriza solo a la CA que usa Cloudflare. DNSSEC activado. |
| Correo | SPF, DKIM (en Microsoft 365) y DMARC `p=quarantine`, que sube a `p=reject` tras 30 días de reportes limpios. |

## 5. Identidades y accesos

### 5.1 Personas

| Grupo de Entra ID | Para qué | Permisos |
|---|---|---|
| `SG-Soporte-Agentes` | Usar la mesa de soporte | Pasa Cloudflare Access hacia `agentes.` |
| `SG-Soporte-Admins` | Administrar la mesa (configuración funcional) | Pasa Access hacia `agentes.`, más el rol de admin dentro de la app |
| `SG-Soporte-Infra` | Operar la infraestructura | *Contributor* en `rg-soporte-prod`; *Key Vault Secrets Officer*; SSH por Cloudflare Access |
| `SG-Soporte-Auditoria` | Revisión y cumplimiento | *Reader* + *Log Analytics Reader* |
| Cuentas *break-glass* (2) | Emergencias | *Owner* de la suscripción, excluidas del Acceso Condicional, contraseña larga en sobre sellado, alerta a Teams cada vez que inician sesión |

- **Acceso Condicional** (requiere Entra ID P1, incluido en Microsoft 365 Business Premium/E3): MFA resistente a phishing para `SG-Soporte-Infra` y admins, y bloqueo de países fuera de los que operen.
- Si Neitek tiene **Entra ID P2**, el rol de `SG-Soporte-Infra` se vuelve "elegible" con **PIM**: se activa por horas, con justificación.
- Revisión de accesos trimestral (quién sigue en cada grupo).

### 5.2 Acceso al servidor

| Vía | Uso | Cómo |
|---|---|---|
| **Cloudflare Access SSH** (principal) | Mantenimiento | Certificados SSH de corta duración emitidos tras login con Entra ID. Cada persona entra con su propio usuario Linux; no existen llaves SSH permanentes. Sesión registrada en los logs de Access. |
| **`az vm run-command`** (emergencia) | Si el Tunnel o Cloudflare fallan | Pasa por el plano de control de Azure (no abre puertos). Requiere el rol de Azure y queda en el Activity Log. |
| Consola serie de Azure | Último recurso (arranque roto) | Usuario local con contraseña en Key Vault, solo para este caso. |

### 5.3 Identidades de servicio (sin contraseñas)

| Identidad | Accede a | Rol mínimo |
|---|---|---|
| Managed Identity de la VM | Key Vault | *Key Vault Secrets User* (solo lectura de secretos) |
| | `st-adjuntos` | *Storage Blob Data Contributor* en su contenedor |
| | `st-respaldos` | *Storage Blob Data Contributor* en los contenedores de pgBackRest. **No** puede cambiar políticas de inmutabilidad ni borrar la cuenta. |
| Aplicación de Entra ID "Soporte-Correo" | Buzón `soporte@` | `Mail.ReadWrite` y `Mail.Send` acotados **solo a ese buzón** con *RBAC for Applications* de Exchange Online. Credencial: certificado guardado en Key Vault, renovado cada año. |
| GitHub Actions | Despliegue | Federación OIDC (sin secretos guardados), con un rol personalizado que solo permite `run-command` en esa VM y leer su estado. |
| Azure DevOps | Work items | PAT con *Work Items Read & Write* en un solo proyecto, caducidad de 90 días, en Key Vault. |

## 6. PostgreSQL operado por Neitek

### 6.1 Instalación

- Contenedor oficial `postgres:16` (o 17), fijado por *digest*. Los datos van en el **disco Premium de datos**, montado en `/var/lib/postgresql`.
- Solo escucha en la red interna de Docker: no publica puertos al host.
- TLS obligatorio aun dentro de la red interna (`ssl=on`, `hostssl` en `pg_hba.conf`) y autenticación `scram-sha-256`.
- Usuarios separados:
  - `app_rw`: la aplicación, sin permisos de DDL.
  - `app_migrator`: solo para migraciones durante el despliegue.
  - `app_audit_writer`: solo INSERT en la tabla de auditoría.
  - `backup`.
- Las contraseñas se generan al instalar y viven en Key Vault.
- Parámetros iniciales para 8 GB compartidos: `shared_buffers=1GB`, `effective_cache_size=3GB`, `work_mem=16MB`, `max_connections=50` (la app usa *pool*).
- Extensiones: solo las necesarias (`pg_trgm`, `unaccent`, `pgcrypto`).
- Cifrado en reposo: el disco administrado ya está cifrado, y además se activa el **cifrado en host** (gratuito), que cubre discos temporales y caché.

### 6.2 Respaldos con pgBackRest

| Repositorio | Destino | Qué guarda | Retención | Protección |
|---|---|---|---|---|
| **repo1** | `st-respaldos/pgbackrest-repo1` (Cool, GRS) | Completo semanal (domingo 02:00), diferencial diario (02:00), **WAL continuo** (`archive_timeout=60s`) | 35 días | Versionado + *soft delete* de 14 días |
| **repo2** | `st-respaldos/pgbackrest-repo2` (Cool, GRS) | Copia del completo semanal con su WAL | 90 días | Versionado + **inmutabilidad WORM a nivel de versión de 30 días** (bloqueada). Nadie puede borrar una versión antes de 30 días, ni la Managed Identity ni un admin. |

- Los respaldos van **cifrados del lado del cliente** por pgBackRest (`repo-cipher-type=aes-256-cbc`), con la frase en Key Vault y una copia en el sobre de *break-glass*. Microsoft solo ve bloques cifrados.
- Autenticación hacia Blob con la Managed Identity de la VM (`repo-azure-key-type=auto`), sin llaves de Storage.
- `pgbackrest check` cada hora; si falla, alerta.
- **RPO:** ~1 minuto (último WAL archivado). En el peor caso, el *archive_timeout* más la latencia de subida: ≤5 min.
- **Restauración a un punto en el tiempo:** `pgbackrest restore --type=time --target="2026-10-20 13:45:00-06"`.
- **Punto a validar en la primera prueba:** pgBackRest reescribe sus archivos de índice (`backup.info`, `archive.info`). Con WORM *a nivel de versión* la reescritura crea una versión nueva y la anterior queda protegida, que es lo que se busca. Por eso no se usa WORM *a nivel de contenedor*, que prohibiría reescribir. Hay que confirmarlo en *staging* antes de bloquear la política, porque **una política bloqueada no se puede quitar**.
- Exportación lógica adicional: `pg_dump` mensual cifrado a repo2, para poder restaurar en otra versión de PostgreSQL si hiciera falta.

### 6.3 Mantenimiento de PostgreSQL

| Tarea | Frecuencia | Cómo |
|---|---|---|
| Versión menor (parches) | Mensual o ante un CVE crítico | Actualizar el *digest* en el repo; el pipeline lo despliega con respaldo previo; ~1 min de corte |
| Versión mayor | Cada 2–3 años | `pg_upgrade` probado antes en *staging* |
| `VACUUM`/`ANALYZE` | Automático (autovacuum) | Alerta si aumenta el *bloat* |
| Crecimiento de disco | Continuo | Alerta al 70 % y al 85 %; el disco Premium se amplía en caliente |
| Revisión de consultas lentas | Mensual | `pg_stat_statements` |

## 7. Adjuntos y almacenamiento

- `st-adjuntos`:
  - Contenedor privado y versionado, con *soft delete* de 14 días.
  - Regla de ciclo de vida: pasar a Cool a los 90 días y borrar según la política de retención que se defina.
  - Escaneo con ClamAV en la VM antes de marcar un adjunto como disponible.
  - Opcional: **Defender for Storage** con escaneo de malware al subir. Cuesta ~$10/mes por cuenta más un cargo por GB escaneado y es redundante con ClamAV; considerarlo solo si una auditoría lo pide.
- Descarga mediante **SAS de delegación de usuario** (firmada con la identidad, no con llave), válida ≤5 minutos y generada solo después de comprobar los permisos en la app.
- Las dos cuentas de Storage tienen TLS mínimo 1.2, acceso anónimo deshabilitado, clave compartida deshabilitada y bloqueo de recurso (`CanNotDelete`).

## 8. Endurecimiento del servidor

- Imagen Ubuntu 24.04 LTS con **Trusted Launch** (arranque seguro + vTPM) y **cifrado en host**.
- Configuración con **cloud-init** versionado en el repo: Docker, `ufw`, `unattended-upgrades` (solo actualizaciones de seguridad, reinicio automático a las 03:00 los domingos si hace falta), `auditd`, `fail2ban` (aunque no hay SSH expuesto), *hardening* CIS nivel 1 donde no rompa nada, NTP y zona horaria UTC.
- Docker:
  - Contenedores no-root, `read_only: true` donde se pueda, `no-new-privileges`, sin `--privileged`.
  - Límites de memoria por servicio (ClamAV ~1.5 GB, PostgreSQL ~3 GB, etc.) para que uno no tumbe a los demás.
  - Imágenes fijadas por *digest*, firmadas con cosign y escaneadas con Trivy en CI.
- Azure Update Manager para el reporte de cumplimiento de parches.
- Defender for Servers P1: EDR (Defender for Endpoint en Linux), evaluación de vulnerabilidades y alertas a Teams.
- Azure Policy asignada a la suscripción:
  - solo Mexico Central (más la región par para GRS);
  - prohibir NSGs con entrada desde Internet;
  - exigir Trusted Launch y cifrado en host;
  - Storage sin clave compartida y TLS 1.2;
  - Key Vault con *purge protection*;
  - etiquetas obligatorias.

## 9. Monitoreo y alertas (todo a un canal de Teams)

| Señal | Umbral | Fuente |
|---|---|---|
| Sitio caído (portal y agentes) | 2 fallos consecutivos | Monitor externo gratuito, cada 1–5 min |
| `/health` o `/ready` con error | 3 min | Azure Monitor (logs del contenedor) |
| CPU sostenida / créditos de la serie B bajos | >80 % por 15 min / créditos < 20 % | Métricas de la VM |
| Memoria disponible | <10 % | Azure Monitor Agent |
| Disco | >70 % (aviso), >85 % (crítico) | Azure Monitor Agent |
| `pgbackrest check` o archivado de WAL falla | 1 vez | Log del job |
| Último respaldo completo | >8 días | Log del job |
| Cola de correo saliente o entrante atascada | >15 min | Métrica de la app |
| Escaneo antivirus con error / archivo infectado | 1 evento | Métrica de la app |
| Inicio de sesión de *break-glass* | 1 evento | Entra ID sign-in logs |
| Cambio de RBAC, políticas de Storage o Key Vault | 1 evento | Activity Log |
| Alerta de Defender (severidad media o más) | 1 evento | Defender for Cloud |
| Certificado de la app de correo por vencer | 30 días antes | Key Vault |

Los logs de la app (sin datos personales; el logger los redacta), los del sistema y los de Cloudflare Access se retienen 90 días en Log Analytics, o lo que fije el SGSI. Si Neitek usa Microsoft Sentinel, se conectan ahí.

## 10. Despliegue continuo

1. *Pull request* → CI: lint, pruebas, SAST, escaneo de dependencias y secretos, construcción de imágenes, Trivy.
2. *Merge* a `main`: las imágenes se publican en GitHub Container Registry (o Azure Container Registry Basic, ~$5/mes, si prefieren todo en Azure) y se **firman con cosign**.
3. Despliegue a *staging*: automático. A **producción**: requiere aprobación manual en el entorno `production` de GitHub.
4. El job de despliegue entra a Azure con **OIDC** (sin secretos) y ejecuta `az vm run-command` en la VM con un script versionado que:
   1. verifica la firma de las imágenes;
   2. hace `pgbackrest backup --type=incr` previo;
   3. ejecuta migraciones con `app_migrator`;
   4. `docker compose up -d` con los nuevos *digests*;
   5. espera `/ready`;
   6. si falla, revierte a los *digests* anteriores.
5. Ventana de despliegue sugerida: fuera del horario de soporte (después de las 18:30 o en fin de semana).

## 11. Recuperación ante desastres

| Escenario | Qué se hace | Tiempo estimado |
|---|---|---|
| Se cae un contenedor | Docker lo reinicia (`restart: unless-stopped`) | Segundos |
| Despliegue defectuoso | *Rollback* automático o manual a los *digests* anteriores | 5–10 min |
| Error humano en datos (borrado) | Restauración a un punto en el tiempo **en *staging***, extracción de lo perdido y reinserción | 1–2 h |
| VM corrupta o comprometida | **Terraform** crea una VM nueva → cloud-init → se descargan las imágenes → `pgbackrest restore` → `cloudflared` se reconecta con el mismo token, **sin cambiar DNS** | 2–4 h |
| Ransomware o atacante con acceso a la VM | Igual que el anterior, en una VM limpia y restaurando desde **repo2 (WORM)**, después de rotar todos los secretos y revisar el incidente | 4–8 h |
| Caída de toda la región Mexico Central | Restaurar en la región par usando la copia GRS de `st-respaldos` (requiere iniciar *failover* de la cuenta) | 8–24 h |

Los adjuntos no se pierden en ningún escenario porque viven en Blob, fuera de la VM.

## 12. Rutina operativa

| Frecuencia | Tarea | Responsable |
|---|---|---|
| Automático diario | Respaldos, `pgbackrest check`, parches de seguridad del SO, actualización de firmas de ClamAV | Sistema |
| Semanal (~15 min) | Revisar alertas, recomendaciones de Defender y uso de recursos | `SG-Soporte-Infra` |
| Mensual (~1 h) | Actualizar imágenes base y PostgreSQL menor, revisar costos y consultas lentas | `SG-Soporte-Infra` |
| Trimestral (~3 h) | **Prueba de restauración** completa en *staging* (medir RTO real), revisión de accesos, rotación de secretos que no rotan solos | Infra + Auditoría |
| Anual | Prueba de penetración, simulacro de desastre (escenario "VM comprometida"), revisión de la reserva y del dimensionamiento | Neitek / tercero |

Esfuerzo estimado de operación: **~3–4 horas al mes** en régimen normal. Ese es el "costo oculto" frente a PostgreSQL administrado.

## 13. Comparación con la opción A (PostgreSQL administrado)

| Aspecto | A. Azure con PostgreSQL Flexible | Azure optimizado |
|---|---|---|
| Costo | ~$100–130 (pago por uso) | ~$50–60 base / ~$70–85 con Cloudflare Pro |
| Restauración a un punto en el tiempo | Sí, administrada (hasta 35 días) | Sí, con pgBackRest (35 días) + copia inmutable de 90 días |
| Respaldo inmutable contra ransomware | Hay que montarlo aparte | Incluido (repo2 WORM) |
| Parches de PostgreSQL | Microsoft | Neitek, mensual y automatizado por pipeline |
| Disponibilidad de PostgreSQL Flexible en Mexico Central | Por confirmar | No aplica |
| Separación cómputo/datos | Sí | No: la base de datos vive en la VM (los adjuntos y respaldos no) |
| Esfuerzo de operación | ~1–2 h/mes | ~3–4 h/mes |
| Seguridad de acceso (sección 4 del doc 03) | Completa | Completa e idéntica |

## 14. Cuándo crecer

| Señal | Acción |
|---|---|
| CPU o créditos de la serie B agotados con frecuencia | Cambiar a D2as_v6 o B4as_v2 (cambio de tamaño con un reinicio) |
| Base de datos > 50 GB o carga de operación de PostgreSQL molesta al equipo | Migrar a Azure Database for PostgreSQL Flexible (dump/restore o replicación lógica) |
| Más de ~100 agentes, o se exige alta disponibilidad | Azure Container Apps + PostgreSQL Flexible con HA (opción B del doc 03) |

La app es portable (Docker Compose, configuración 12-factor), así que cualquier salto es una migración planeada, no una reescritura.

## 15. Prerrequisitos y decisiones abiertas

1. Suscripción de Azure dedicada (o grupo de recursos aislado) y quién será su *Owner*.
2. Licenciamiento de Entra ID: ¿P1 (Acceso Condicional)? ¿P2 (PIM)?
3. ¿Cloudflare Free o Pro? (recomendado: Pro).
4. ¿Se contrata *staging*? (recomendado: sí; también sirve para las pruebas de restauración).
5. Arrancar con pago por uso 3 meses y luego decidir entre reserva de 3 años o Savings Plan.
6. Quién integra `SG-Soporte-Infra` y cubre la rutina operativa de la sección 12.
7. Retención de logs y respaldos según el SGSI / ISO 27001 (aquí se asumieron 90 días).

## 16. Orden de implementación

1. Suscripción, grupos de Entra ID, Azure Policy y *budget alerts*.
2. Terraform: VNet, NSG, VM (Trusted Launch, cifrado en host), discos, IP, Key Vault, dos cuentas de Storage (sin inmutabilidad bloqueada aún), Log Analytics, Defender.
3. cloud-init: Docker, endurecimiento, agentes.
4. Cloudflare: zona, Tunnel, Access (agentes y SSH) con Entra ID, WAF y *rate limiting*.
5. Microsoft 365: buzón `soporte@`, app de Entra con certificado, *RBAC for Applications*, SPF/DKIM/DMARC.
6. Despliegue de la app, pgBackRest configurado, primer respaldo.
7. **Prueba de restauración en *staging*** (incluido el punto de 6.2), y **después** bloquear la política WORM de repo2.
8. Alertas y monitoreo externo.
9. Prueba de penetración ligera y salida a producción con los primeros clientes.

## Fuentes

- Precio de la VM B2as_v2 en Mexico Central: [azurespeed.com](https://www.azurespeed.com/AzureVmPricing/Standard_B2as_v2), [cloudprice.net](https://cloudprice.net/vm/Standard_B2as_v2)
- Reservas de Azure, intercambios y cancelaciones: [azure.microsoft.com](https://azure.microsoft.com/pricing/reserved-vm-instances/), [redresscompliance.com](https://redresscompliance.com/microsoft-azure-reserved-instances-vs-savings-plans.html)
- Limitar una app a un solo buzón: [learn.microsoft.com](https://learn.microsoft.com/graph/auth-limit-mailbox-access)
- Planes de Cloudflare: [eastondev.com](https://eastondev.com/blog/en/posts/dev/20251201-cloudflare-pricing-compare/), [costbench.com](https://costbench.com/software/business-vpn/cloudflare-zero-trust/free-plan/)
