# Despliegue de la mesa de soporte: opción de hospedaje, acceso y seguridad

> Precios de referencia consultados en octubre de 2026, en USD/mes, antes de impuestos. Casi todos vienen de rastreadores de precios de terceros. **Confírmalos en la calculadora de cada proveedor antes de contratar.**

## 1. Supuestos de dimensionamiento

- Hasta ~50 agentes, ~300 organizaciones y ~5,000 tickets/mes (valor por defecto del prompt, sección 10).
- Servicios a ejecutar: API, web, worker, Redis, ClamAV (~1–1.5 GB de RAM por sí solo) y PostgreSQL.
- Con ese volumen basta **1 servidor de 2 vCPU y 8 GB de RAM**. ClamAV es lo que obliga a tener 8 GB en vez de 4.
- Disponibilidad objetivo: horario de oficina en México. Un RTO de horas es aceptable, así que no hace falta alta disponibilidad multi-zona en el arranque.

## 2. Opciones comparadas

| Opción | Qué incluye | Costo aprox./mes | Datos en México | Pros | Contras |
|---|---|---|---|---|---|
| **A. Azure, región Mexico Central: VM + PostgreSQL administrado** (recomendada) | VM B2as_v2 (2 vCPU, 8 GB) con Docker Compose; Azure Database for PostgreSQL Flexible B1ms; Blob Storage; Key Vault; Cloudflare delante | **~$100–130** pago por uso; **~$75–95** con reserva de 1 año | Sí | Misma nube, identidad (Entra ID) y Microsoft 365 que ya usa Neitek. Proveedor ya conocido para ISO 27001. Respaldos con restauración a un punto en el tiempo (PITR). | Unos $60–80 más al mes que la opción más barata. |
| B. Azure administrado completo | Container Apps + PostgreSQL Flexible + Azure Cache for Redis + Front Door/WAF | ~$200–350 | Sí | Escalado automático y menos servidores que administrar. | Mucho más caro para este volumen. Conviene más adelante, si crece. |
| C. DigitalOcean | Droplet 8 GB + Managed PostgreSQL ($15) + Spaces | ~$65–90 | No (lo más cercano es NYC/SFO) | Simple y precio predecible. | Otro proveedor más que evaluar para ISO 27001. Sin integración con Entra ID ni con la red de Inncentives. |
| D. AWS Lightsail | Instancia 8 GB ($44) + base de datos ($15) | ~$65–80 | No para Lightsail | Paquetes con transferencia incluida. | Las mismas desventajas que C. |
| E. Hetzner Cloud | CX33 (4 vCPU, 8 GB) + respaldos | ~$12–20 | No (solo Alemania y Finlandia en esa línea) | La más barata por mucho. | Subió precios dos veces en 2026. La línea CX/CAX aparece como "no disponible" desde junio. Latencia alta desde México (~150 ms). Datos fuera de México. |

**Recomendación: opción A.** Hetzner o DigitalOcean ahorran entre $60 y $100 al mes, pero a cambio:

- habría que meter un proveedor nuevo en el alcance de ISO 27001;
- los datos saldrían de México;
- se perdería la integración nativa con Entra ID, Microsoft 365 (buzón de soporte por Graph) y la red de Azure donde vivirá la API de Inncentives.

Para una herramienta que guarda datos de clientes y que puede recibir datos de nómina, esa diferencia no compensa.

> **Verificar antes de contratar:** que **Azure Database for PostgreSQL Flexible Server** esté disponible en Mexico Central. No encontré una confirmación oficial. Si no lo está, ejecuta PostgreSQL en un contenedor dentro de la misma VM con los respaldos de la sección 4.6. No pongas la base de datos en otra región: la latencia entre la VM y la base de datos degradaría la aplicación.

## 3. Arquitectura recomendada

```
 Clientes (portal)                  Agentes / admins
 soporte.inncentives.com            agentes.soporte.inncentives.com
         │                                   │
         ▼                                   ▼
 ┌──────────────────────── Cloudflare ─────────────────────────────┐
 │ DNS · TLS · WAF · DDoS · rate limiting · bots                   │
 │ Access (Zero Trust) SOLO para el host de agentes: Entra ID + MFA│
 └──────────────────────────────┬──────────────────────────────────┘
                                │ Cloudflare Tunnel (saliente; sin puertos entrantes)
 ┌──────────────── Azure · Mexico Central · suscripción dedicada ─────────────┐
 │  VNet privada                                                              │
 │  ┌──────────────── VM B2as_v2 (Ubuntu LTS) ───────────────┐                │
 │  │ cloudflared · caddy · api · web · worker · redis · clamav│                │
 │  │ Managed Identity ──► Key Vault (secretos)                │                │
 │  │                  └─► Blob Storage (adjuntos, respaldos)  │                │
 │  └──────────────────────┬──────────────────────────────────┘                │
 │                         │ red privada (VNet integration)                      │
 │  PostgreSQL Flexible B1ms (sin acceso público, TLS obligatorio, PITR)        │
 │  NSG: 0 puertos entrantes desde Internet                                     │
 └────────────────────────────────────────────────────────────────────────────┘
        │ Microsoft Graph (solo el buzón soporte@)      │ Azure DevOps / Teams
        ▼                                                ▼
   Microsoft 365 de Neitek                        Servicios de Neitek
```

### Desglose de costo de la opción A (pago por uso, estimado)

| Componente | Aprox./mes |
|---|---|
| VM B2as_v2 Linux, Mexico Central (~$0.083/h) | ~$60 (≈$38–40 con reserva de 1 año) |
| Disco del SO Standard SSD 64–128 GB | ~$6–10 |
| PostgreSQL Flexible B1ms + 32 GB de almacenamiento | ~$17–25 |
| Blob Storage (adjuntos + respaldos, pocas decenas de GB, GRS) | ~$2–5 |
| IP pública estándar (solo para tráfico **saliente**; NSG bloquea todo lo entrante) | ~$4 |
| Azure Backup de la VM | ~$5–10 |
| Key Vault, Log Analytics (ingesta baja), Defender CSPM gratuito | ~$0–5 |
| Defender for Servers Plan 1 (opcional, recomendado) | ~$5 |
| Cloudflare Free + Zero Trust Free (hasta 50 usuarios) | $0 |
| Buzón compartido `soporte@` en Microsoft 365 (no requiere licencia) | $0 |
| **Total** | **~$100–130** |

Opcionales que valen la pena después:
- Cloudflare Pro (~$20–25) para reglas WAF más completas.
- Una VM de *staging* pequeña (~$15–30) que se pueda apagar cuando no se use.

## 4. Acceso y seguridad

### 4.1 Separación del entorno

- **Suscripción de Azure dedicada** (o al menos un grupo de recursos y una VNet propios), separada de Inncentives Prod. Un incidente en la mesa de soporte no debe poder alcanzar Inncentives, ni al revés.
- Azure Policy en esa suscripción: solo la región Mexico Central, prohibir IPs públicas en puertos entrantes, prohibir el acceso por clave compartida a Storage y exigir cifrado.

### 4.2 Exposición a Internet: cero puertos abiertos

- El NSG de la VM **niega todo el tráfico entrante desde Internet**, incluido el puerto 22.
- El tráfico web llega solo por **Cloudflare Tunnel** (`cloudflared` abre una conexión saliente). Así nadie puede saltarse el WAF atacando directamente la IP de origen.
- La IP pública solo existe para el tráfico saliente: Graph, Azure DevOps, actualizaciones. Azure ya no da salida a Internet por defecto en las VNets nuevas, y una NAT Gateway (~$32/mes) costaría más.
- Cloudflare aplica TLS 1.2+/HSTS, WAF con reglas administradas (OWASP), protección DDoS, *rate limiting* en `/login`, `/mfa` y `/password-reset`, y gestión de bots.
- Nota de privacidad: Cloudflare termina TLS y procesa el tráfico como **encargado** del tratamiento. Firma su DPA y menciónalo en el aviso de privacidad. La alternativa equivalente dentro de Azure (Front Door + WAF) cuesta bastante más.

### 4.3 Acceso de usuarios a la aplicación

| Quién | Host | Control de red (Cloudflare) | Control en la aplicación |
|---|---|---|---|
| Administradores de clientes | `soporte.inncentives.com` | Público con WAF y rate limiting | Cuenta por invitación, contraseña + MFA (recomendado u obligatorio por organización) |
| Agentes y admins de Neitek | `agentes.soporte.inncentives.com` | **Cloudflare Access**: login con Entra ID (MFA y Acceso Condicional de Neitek), solo los grupos `SG-Soporte-Agentes` y `SG-Soporte-Admins` | Sesión propia de la app + MFA. En fase 2, SSO OIDC con Entra ID |
| Webhooks entrantes (Graph, CTI, Azure DevOps) | Rutas `/hooks/*` | Excluidas de Access, con reglas WAF por ruta y *rate limiting* | Validación de token/firma HMAC (ver prompt, 4.3 y 4.10) |

Así un atacante necesita superar **dos** barreras (Entra ID y la app) para llegar a la interfaz de agentes, aunque se filtre una contraseña de la aplicación.

> **Ajuste al prompt:** la app debe poder servir el área de agentes/admin en un host distinto del portal de clientes. Los endpoints de agentes y admin solo responden en ese host, y las cookies se separan por host. Ya lo agregué en `02-prompt-mesa-soporte.md`.

### 4.4 Acceso administrativo a la infraestructura

- **Sin SSH público.** Se entra por SSH a través de **Cloudflare Access** (certificados de corta duración y login con Entra ID). Como alternativa, Azure Bastion.
- En la VM se activa el **inicio de sesión con Entra ID para Linux**: no hay llaves SSH compartidas, cada persona entra con su identidad y queda registrada.
- RBAC de Azure por grupos de Entra ID con mínimo privilegio:
  - `SG-Soporte-Infra`: Contributor solo en el grupo de recursos.
  - Lectura para auditoría.
  - Si Neitek tiene Entra ID P2, usar **PIM** (elevación temporal con aprobación).
- **Dos cuentas de emergencia (*break-glass*)** con credenciales en sobre sellado o en una bóveda separada, excluidas del Acceso Condicional, con alerta cada vez que se usen.

### 4.5 Secretos e identidades de servicio

- La VM usa una **Managed Identity**:
  - Key Vault: rol *Key Vault Secrets User*, solo para leer secretos.
  - Blob Storage: rol *Storage Blob Data Contributor* acotado a sus contenedores.
  - **Acceso por clave compartida deshabilitado** en la cuenta de Storage.
- Key Vault con *soft delete* y *purge protection*, acceso por red privada o restringido a la VNet.
- Ningún secreto en el repositorio, en variables de CI ni en imágenes. Los secretos se cargan desde Key Vault al arrancar.
- **Buzón `soporte@`:**
  - Es un buzón compartido.
  - Registro de aplicación en Entra ID con **credencial de certificado** (no *client secret*).
  - Permisos `Mail.ReadWrite` y `Mail.Send` **acotados solo a ese buzón** mediante *RBAC for Applications* de Exchange Online, que sustituye a las *Application Access Policies*. Sin un permiso amplio en Entra, la app no puede leer ningún otro buzón de Neitek.
  - Publicar SPF, DKIM y DMARC (`p=quarantine` o `reject`) en el dominio de envío.
- Azure DevOps: PAT con alcance mínimo (*Work Items: Read & Write* en un solo proyecto), con caducidad y rotación; o un service principal.

### 4.6 Datos, cifrado y respaldos

- Cifrado en reposo en todos los servicios (por defecto en Azure). TLS obligatorio hacia PostgreSQL.
- PostgreSQL:
  - Sin acceso público; solo desde la VNet.
  - PITR de 7 a 35 días (configurar 35).
  - Respaldo geo-redundante si la región lo permite.
- Respaldo lógico diario (`pg_dump` cifrado) a un contenedor de Blob con **versionado y política de inmutabilidad (WORM)**. Así un atacante con acceso a la VM no puede borrar los respaldos.
- Azure Backup de la VM con retención diaria y semanal.
- **Prueba de restauración trimestral** documentada. Objetivos: RPO ≤ 24 h (≤ 5 min con PITR) y RTO ≤ 8 h.

### 4.7 Endurecimiento y parches

- Ubuntu LTS con actualizaciones de seguridad automáticas (`unattended-upgrades`) y Azure Update Manager para el reporte.
- Docker:
  - Contenedores no-root y sistema de archivos de solo lectura donde se pueda.
  - Imágenes fijadas por *digest* y escaneadas con Trivy en CI.
  - **Sin actualización automática de contenedores** (nada de Watchtower): todo cambio pasa por el pipeline.
- Firewall del host (`ufw`) que también niega lo entrante, como segunda capa además del NSG.
- Defender for Servers P1 (EDR y evaluación de vulnerabilidades) y Defender CSPM gratuito para revisar la postura de seguridad.

### 4.8 Despliegue continuo sin credenciales permanentes

- GitHub Actions construye, prueba y escanea las imágenes, y las publica en GitHub Container Registry, o en Azure Container Registry Basic (~$5) si prefieren mantenerlo dentro de Azure.
- El despliegue usa **federación OIDC de GitHub con Entra ID**: no hay secretos de Azure guardados en GitHub. Ejecuta `az vm run-command` para hacer *pull* de las imágenes por digest y `docker compose up -d`.
- El entorno `production` en GitHub exige aprobación manual. Las migraciones de base de datos se ejecutan como paso explícito, con respaldo previo.

### 4.9 Monitoreo y auditoría

- Azure Monitor Agent → Log Analytics: logs del sistema y de los contenedores (sin datos personales; la app ya los redacta). Retención de 90 días o la que fije ISO 27001.
- Registros de Cloudflare (Access y WAF) y del *audit log* de la aplicación. Si Neitek usa Microsoft Sentinel, se envían ahí.
- Alertas a un canal de Teams para:
  - servicio caído (prueba de disponibilidad externa);
  - cola de correo atascada;
  - fallos del escaneo antimalware;
  - disco > 80 %;
  - inicios de sesión de *break-glass*;
  - cambios de RBAC.

### 4.10 Cumplimiento

- Datos alojados en México (Mexico Central). Las transferencias a Cloudflare y Microsoft se cubren con sus DPAs y se incluyen en el aviso de privacidad (LFPDPPP).
- Azure y Cloudflare tienen ISO 27001 y SOC 2. Se registran en el inventario de proveedores del SGSI de Neitek.
- Este documento, el modelo de amenazas y la matriz ASVS del prompt son la evidencia para la auditoría.

## 5. Plan de puesta en marcha

1. Crear la suscripción o grupo de recursos, la VNet, el NSG y las Azure Policies. Verificar la disponibilidad de PostgreSQL Flexible en Mexico Central.
2. Crear el buzón compartido `soporte@`, el registro de aplicación con certificado, el alcance *RBAC for Applications* y SPF/DKIM/DMARC.
3. Desplegar la VM, PostgreSQL, Storage (sin clave compartida, con inmutabilidad en respaldos) y Key Vault, con la Managed Identity y sus roles.
4. Configurar Cloudflare: zona DNS, Tunnel, WAF, *rate limiting* y la aplicación de Access para el host de agentes y para SSH, con Entra ID como proveedor de identidad.
5. Configurar el pipeline de GitHub Actions con OIDC y el entorno `production` con aprobación.
6. Configurar el monitoreo, las alertas a Teams, Azure Backup y la primera prueba de restauración.
7. Hacer una prueba de penetración ligera (OWASP ZAP + revisión manual de autorización) antes de invitar a los primeros clientes.

## Fuentes de precios consultadas

- Azure VM B2as_v2 por región: [azurespeed.com](https://www.azurespeed.com/AzureVmPricing/Standard_B2as_v2), [cloudprice.net](https://cloudprice.net/vm/Standard_B2as_v2)
- Azure PostgreSQL Flexible B1ms: [bytebase.com](https://www.bytebase.com/dbcost/azure-flexible/instance/B1ms/)
- Reservas de Azure: [azure.microsoft.com](https://azure.microsoft.com/pricing/reserved-vm-instances/)
- Hetzner 2026: [northflank.com](https://northflank.com/blog/hetzner-cloud-server-price-increases), [findstack.com](https://findstack.com/resources/hetzner-price-increase-2026)
- DigitalOcean: [infratally.com (Droplets)](https://infratally.com/articles/digitalocean-droplet-pricing-guide-2026/), [infratally.com (PostgreSQL)](https://infratally.com/articles/digitalocean-managed-postgres-deep-dive/)
- AWS Lightsail: [kuberns.com](https://kuberns.com/blogs/aws-lightsail-pricing-your-comprehensive-guide/)
- Cloudflare Zero Trust y planes: [costbench.com (Zero Trust Free)](https://costbench.com/software/business-vpn/cloudflare-zero-trust/free-plan/), [eastondev.com](https://eastondev.com/blog/en/posts/dev/20251201-cloudflare-pricing-compare/)
- Exchange Online RBAC for Applications: [learn.microsoft.com](https://learn.microsoft.com/graph/auth-limit-mailbox-access)
