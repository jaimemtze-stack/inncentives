# Guía de despliegue: Oracle Cloud México (Querétaro)

Para la persona de Neitek que aprovisiona. Claude Code **no** ejecuta nada de esto: el código está validado en CI (Terraform `validate`, pruebas de operación y prueba de humo del stack de producción), pero ningún paso toca la nube real hasta que tú lo ejecutes.

Tiempo estimado: medio día la primera vez.

## 0. Requisitos

- Una persona con permisos de administración de la tenancy de OCI (solo para los pasos 1–3), otra con permisos de Cloudflare y otra de Microsoft 365 / Entra ID (pueden ser la misma).
- En tu equipo: `oci` CLI 3.x, Terraform ≥ 1.12, `jq`, `openssl`, `age`.
- Dominio en Cloudflare (por ejemplo `inncentives.com`), con los hosts `soporte.` y `agentes.soporte.`.

## 1. Cuenta de OCI

1. Crea la cuenta y elige como **región de origen Querétaro (`mx-queretaro-1`)**. No se puede cambiar después; si no hay capacidad de Ampere A1, usa Monterrey (`mx-monterrey-1`) y cambia `region` en `terraform.tfvars`.
2. **Convierte la cuenta a pago por uso** (*Upgrade to Pay As You Go*). Los recursos *Always Free* siguen sin costo y Oracle ya no reclama instancias inactivas.
3. Activa **Cloud Guard** en la tenancy (Seguridad → Cloud Guard → Habilitar, región de reporte Querétaro).
4. **Federa la consola con Microsoft Entra ID** (Identidad → Dominios → Default → Proveedores de identidad → SAML). Crea en Entra los grupos `SG-Soporte-Infra` y `SG-Soporte-Auditoria` y asígnalos a la aplicación empresarial de OCI. Desactiva el usuario local de administración, salvo **dos cuentas de emergencia** con MFA cuyas credenciales queden en sobre sellado.

## 2. Estado de Terraform

```bash
oci os bucket create --name mesa-terraform-state --compartment-id <tenancy-ocid> \
  --versioning Enabled --public-access-type NoPublicAccess
cd mesa-soporte/infra/terraform
cp backend.hcl.example backend.hcl            # namespace: oci os ns get
cp terraform.tfvars.example terraform.tfvars  # completa los valores
terraform init -backend-config=backend.hcl
```

## 3. Aprovisionar

```bash
terraform plan -out plan.tfplan     # revisa: ~40 recursos, ninguno con IP pública
terraform apply plan.tfplan
terraform output                    # guarda los OCIDs
```

Mapea los grupos OCI `mesa-prod-infra` y `mesa-prod-auditoria` a los grupos de Entra (`SG-Soporte-Infra`, `SG-Soporte-Auditoria`) en el proveedor de identidad.

## 4. Llave de respaldos (fuera del servidor)

```bash
age-keygen -o mesa-backup.key       # llave PRIVADA: guárdala en el gestor de contraseñas + sobre sellado
age-keygen -y mesa-backup.key       # llave PÚBLICA: va al servidor (paso 7)
```

La llave privada **nunca** se copia al servidor ni a OCI. Sin ella, los volcados inmutables no se pueden leer.

## 5. Credenciales externas

1. **pgBackRest (S3 compatible):** en OCI → Identidad → Usuarios → `svc-mesa-prod-pgbackrest` → *Customer Secret Keys* → Generar. Copia la llave y el secreto.
2. **Cloudflare Tunnel:** Zero Trust → Networks → Tunnels → Create (`mesa-prod`). Copia el token. Rutas públicas del túnel:
   - `soporte.inncentives.com` → `http://web:8080`
   - `agentes.soporte.inncentives.com` → `http://web:8080`
   - `ssh-mesa.inncentives.com` → `ssh://localhost:22` (para el paso 9)
3. **Correo:**
   - Buzón de envío y recepción: `soporte@neitek.net` (Microsoft 365). Debe coincidir en `MAIL_FROM`, `GRAPH_SENDER` y el canal de correo.
   - **Entrada (fase 1, Microsoft Graph):** registra una aplicación en Entra ID con el permiso de aplicación `Mail.ReadWrite` y `Mail.Send`, y **limítala al buzón** con *RBAC for Applications* de Exchange Online (`New-ManagementScope` + `New-ManagementRoleAssignment -App <id> -Role "Application Mail.ReadWrite" -CustomResourceScope`). Crea un secreto de cliente (máximo 12 meses) para `graph_client_secret`. En *Configuración → Canales de correo* registra `tenantId`, `clientId`, `mailbox` y `trustedAuthServ` (el servidor que escribe `Authentication-Results`, normalmente `mx.microsoft.com`; confírmalo en los encabezados de un correo recibido).
   - **Correo del sistema** (invitaciones, notificaciones; fase 2): **recomendado por Graph**. Agrega a la misma aplicación el rol `Application Mail.Send` con el mismo *management scope* del buzón y añade a `/opt/mesa/stack.env`:

     ```
     MAIL_TRANSPORT=graph
     GRAPH_TENANT_ID=<id del tenant>
     GRAPH_CLIENT_ID=<id de la aplicación>
     GRAPH_SENDER=soporte@neitek.net
     ```

     El worker usa `graph_client_secret`. Después de guardar el secreto en Vault y editar `stack.env`, ejecuta `sudo systemctl restart mesa-secrets-sync` (con `start` no se vuelve a ejecutar si ya corrió) y `sudo systemctl restart mesa-stack`. Sin estas variables sigue saliendo por SMTP con STARTTLS (`smtp_username`/`smtp_password`), que Microsoft está retirando para Exchange Online.
   - Alternativa sin Graph: adaptador `imap` (IMAPS 993 + SMTP 587 con TLS); usa el mismo secreto como contraseña.
   - Publica SPF, DKIM y DMARC (`p=quarantine`) del dominio.
4. **Integraciones de la fase 2** (todas opcionales; sin ellas la función queda desactivada):
   - **SSO de agentes (Entra ID):** registra una aplicación web de un solo tenant con URI de redirección `https://agentes.soporte.inncentives.com/api/v1/auth/sso/entra/callback`, permisos delegados `openid`, `email` y `profile`, y un secreto de cliente (máximo 12 meses) para `sso_entra_client_secret`. Si quieres aceptar el MFA de Entra en lugar del propio, exige MFA con Acceso condicional para esa aplicación.
   - **Azure DevOps:** crea un PAT de una cuenta de servicio con alcance **Work Items (Read & write)** y caducidad máxima de un año, para `azure_devops_pat`. El script del paso 6 genera `azure_devops_hook_secret`; en *Project settings → Service hooks* crea una suscripción *Web Hooks* al evento *Work item updated* hacia `https://soporte.inncentives.com/hooks/azure-devops` con usuario cualquiera y ese secreto como contraseña (*Basic*).
   - **Teams:** en cada canal crea un flujo de *Workflows* "Publicar en un canal cuando se reciba una solicitud de webhook" y copia su URL; se registra después en la aplicación (paso 9 ter), no como secreto del servidor.
5. **Canales e integraciones de la fase 3** (opcionales):
   - **Twilio** (voz y SMS): de la consola copia el *Account SID* (va en ajustes) y el *Auth Token* (`twilio_auth_token`). En cada número: *Messaging → A message comes in* → `POST https://soporte.inncentives.com/hooks/twilio/sms`; en tu flujo de voz (TwiML, Studio o SIP) configura *Call status changes* → `https://soporte.inncentives.com/hooks/twilio/voice` (opcional `?agent=<correo>` para dirigir el aviso).
   - **WhatsApp Business (Meta Cloud API):** en Meta Business crea una app con el producto WhatsApp, un usuario de sistema con permiso `whatsapp_business_messaging` y su token permanente (`whatsapp_access_token`); copia el *App secret* (`whatsapp_app_secret`). En *Webhooks* suscribe el campo `messages` con URL `https://soporte.inncentives.com/hooks/whatsapp` y como *Verify token* el valor que genera el script del paso 6 (`whatsapp_verify_token`). Anota el *Phone number ID*.
   - **API de Inncentives:** token de solo lectura (`inncentives_api_token`) cuando la API exista (contrato en `integraciones/api-inncentives.md`). El widget usa `inncentives_widget_secret`, que genera el script; entrégalo por un canal seguro al equipo de Inncentives (`integraciones/widget.md`).
   - **IA (solo si Neitek la aprueba, ADR-0022):** llave de API de una organización de Anthropic con retención cero (`anthropic_api_key`).
6. **GitHub** (dos tokens, ambos con caducidad de 90 días):
   - `github_read_token`: *fine-grained token* limitado a este repositorio con **Contents: read** (lee los releases y su `manifest.json`).
   - `ghcr_read_token`: *token clásico* solo con **`read:packages`**. GHCR no acepta tokens *fine-grained*; este token no da acceso al código.

## 6. Secretos en OCI Vault

```bash
infra/scripts/bootstrap-secrets.sh <compartment_id> <vault_id> <master_key_id> > secrets.map
```

El script genera las contraseñas aleatorias (incluido `cti_webhook_secret` para la futura telefonía), te pide las credenciales del paso 5 sin mostrarlas en pantalla (incluido `graph_client_secret`) y produce `secrets.map` (nombres + OCIDs, **sin valores**).

> **Fase 3:** el script genera `inncentives_widget_secret` y `whatsapp_verify_token` y pide `inncentives_api_token`, `twilio_auth_token`, `whatsapp_access_token`, `whatsapp_app_secret` y `anthropic_api_key` (Enter = `unused`). En una instalación existente crea esos siete secretos antes de desplegar la fase 3.

> **Fase 2:** el script también genera `azure_devops_hook_secret` y pide `azure_devops_pat` y `sso_entra_client_secret`; si aún no los tienes, presiona Enter y se guarda el valor `unused` (la integración queda desactivada). Para cargarlos después, crea una nueva versión del secreto en OCI Vault (`runbooks/rotacion-secretos.md`). En una instalación existente, crea los tres secretos nuevos con el mismo prefijo y agrégalos a `/opt/mesa/secrets.map` antes de desplegar la fase 2: el compose los exige.

> **Fase 1:** el stack agrega el servicio `jobs` (misma imagen que la API: correo entrante/saliente, SLAs, planificadores, antivirus, retención y privacidad) y usa ClamAV (`clamav`, 3 GB de RAM; la primera descarga de firmas tarda unos minutos). Las migraciones de la fase 1 (`20261018…`) se aplican solas con el migrador del desplegador.

## 7. Primer arranque del servidor

Entra por OCI Bastion (sesión SSH administrada, ≤ 3 h) o, una vez configurado, por Cloudflare Access (paso 9):

```bash
sudo install -m 0640 secrets.map /opt/mesa/secrets.map
echo "age1…(llave pública)" | sudo tee /opt/mesa/backup-age-recipient.txt
sudo systemctl start mesa-secrets-sync      # trae los secretos a /run/mesa/secrets (tmpfs)
sudo systemctl start mesa-deployer          # instala el último release aprobado
sudo systemctl enable --now mesa-stack
sudo /opt/mesa/scripts/backup.sh full       # crea el stanza y el primer respaldo completo
```

## 8. Cloudflare

- **WAF:** activa las reglas administradas. En el plan Pro, el conjunto OWASP en modo *block* con sensibilidad media.
- **Rate limiting:** `/api/v1/auth/*` con 20 peticiones por minuto por IP; bloqueo de 10 minutos.
- **SSL/TLS:** *Full (strict)* no aplica con Tunnel (el origen es el túnel). Activa *Always Use HTTPS*, TLS mínimo 1.2, HSTS y *Automatic HTTPS Rewrites*.
- **Access, aplicación "Mesa – agentes":**
  - host `agentes.soporte.inncentives.com`;
  - política *Allow* para los grupos de Entra `SG-Soporte-Agentes` y `SG-Soporte-Admins`, exigiendo MFA;
  - política *Bypass* para la ruta `/hooks/*` (webhooks de la fase 1, que validan su propia firma);
  - duración de sesión de 8 h.
- **Portal de clientes:** **sin** Access, pero con WAF y *Bot Fight Mode*.
- **Webhooks de proveedores (fase 3):** Twilio y Meta llaman a `soporte.inncentives.com/hooks/*`. Crea una regla de WAF *Skip* (Bot Fight Mode / Super Bot Fight Mode y desafíos) para la ruta `/hooks/` — la API exige la firma de cada proveedor y responde 401 sin ella.

## 9. Acceso SSH sin llaves (Cloudflare Access)

1. Zero Trust → Access → *Service Auth* → **SSH** → genera la CA de certificados de corta duración y copia la llave pública.
2. En el servidor:

   ```bash
   echo "<CA pública>" | sudo tee /etc/ssh/cloudflare_access_ca.pub
   sudo install -d /etc/ssh/principals
   echo "ana.lopez" | sudo tee /etc/ssh/principals/ana     # una línea por persona: usuario de su correo
   sudo adduser --disabled-password ana && sudo usermod -aG docker ana
   sudo systemctl restart ssh
   ```

3. Aplicación de Access para `ssh-mesa.inncentives.com`, permitida solo a `SG-Soporte-Infra`.
4. Cada operador se conecta con `cloudflared access ssh --hostname ssh-mesa.inncentives.com`.

## 9 bis. Después de desplegar la fase 1

1. Entra como administrador y en *Configuración* revisa grupos, calendario (días inhábiles propios), SLAs y ajustes generales (aviso de privacidad).
2. Da acceso a grupos a cada agente (*Agentes y accesos*).
3. Crea el canal de correo y envía un correo de prueba desde una cuenta de cliente registrada: debe crear un ticket en *Soporte N1*; desde una cuenta desconocida, en *Por verificar*.
4. Sube un archivo EICAR de prueba a un ticket: debe quedar *En cuarentena* y generar la nota interna.
5. Deja **desactivadas** las políticas de retención hasta que Neitek defina los plazos.

## 9 ter. Después de desplegar la fase 2

1. **Base de conocimiento:** da el permiso `kb.edit` (rol personalizado) a quienes redactan; las categorías por módulo de Inncentives ya vienen creadas.
2. **SSO:** en *Configuración → Ajustes generales* agrega a `sso_providers`:

   ```json
   [{ "id": "entra", "label": "Microsoft", "area": "agent",
      "issuer": "https://login.microsoftonline.com/<tenant>/v2.0", "clientId": "<id de la aplicación>",
      "secretName": "sso_entra_client_secret", "scopes": "openid email profile", "trustIdpMfa": false }]
   ```

   Cada agente vincula su cuenta en *Mi cuenta → Inicio de sesión único → Vincular con Microsoft* (pide su contraseña); desde entonces aparece el botón en la pantalla de entrada. Pon `trustIdpMfa: true` solo si Acceso condicional exige MFA para la aplicación.
3. **Azure DevOps:** en `azure_devops` de los ajustes generales define `organization`, `project` y `defaultType` (`Bug`, `Task`…). Crea un *work item* de prueba desde un ticket y cambia su estado en DevOps: en menos de un minuto (con el *service hook*) aparece la nota interna.
4. **Teams:** en *Configuración → Canales de Teams* registra cada URL con su grupo y eventos; revisa *Entregas* tras el primer ticket.
5. **Importación:** *Administración → Importar desde CSV*; valida primero y corrige el reporte de errores antes de importar.
6. **Correo del sistema por Graph:** tras cambiar `stack.env`, `sudo systemctl restart mesa-stack` y envía una invitación de prueba.

## 9 quater. Después de desplegar la fase 3

1. **Inncentives:** en *Administración → Organizaciones* captura la clave de tenant de cada cliente. En *Ajustes generales → `inncentives`* deja `mode: "off"` hasta que exista la API; luego `mode: "http"` y `baseUrl`. Entrega `widget.md` y el secreto del widget al equipo de Inncentives.
2. **Teléfono:** haz una llamada de prueba al número de Twilio y verifica que aparezca en *Teléfono* (bitácora de llamadas).
3. **WhatsApp y SMS:** en *Configuración → WhatsApp y SMS* registra cada número (`kind`, `providerId` = *Phone number ID* de Meta o el número de Twilio en E.164, `displayNumber`, `groupId`). En ajustes `messaging` captura `twilioAccountSid`. Envía un mensaje desde un celular registrado en un cliente: debe crear un ticket en el grupo del número; desde uno desconocido, en *Por verificar*. Responde desde el ticket y confirma el estado *Entregado*.
4. **Chat:** en `chat` de los ajustes pon `enabled: true` y el grupo. Los agentes de ese grupo marcan *Disponible para chat* en la página *Chat*.
5. **IA:** solo con aprobación. `ai.enabled: true` en ajustes y la casilla *IA* en cada organización que lo autorice. Revisa en la bitácora las acciones `ai.request`.

## 10. Verificación final (lista de verificación)

- [ ] `terraform plan` sin cambios pendientes.
- [ ] `https://soporte.inncentives.com` y `https://agentes.soporte.inncentives.com` cargan; agentes pide primero el login de Microsoft.
- [ ] `curl -sI https://soporte.inncentives.com | grep -i content-security-policy` muestra la CSP.
- [ ] `sudo /opt/mesa/scripts/backup.sh check` termina sin errores; `systemctl list-timers 'mesa-*'` lista los 6 timers.
- [ ] Llegan los correos de prueba de la alarma (OCI → Monitoring → Alarms → *Test*).
- [ ] **Prueba de restauración** (`runbooks/restauracion.md`), con resultado anotado.
- [ ] **Bloquear la retención del bucket inmutable** (solo después de la prueba anterior; es irreversible):

  ```bash
  oci os retention-rule update --bucket-name respaldos-inmutables --retention-rule-id <id> \
    --time-rule-locked "$(date -u -d '+15 days' +%Y-%m-%dT%H:%M:%SZ)"
  ```

- [ ] Configurar *required reviewers* en el entorno `production` del repositorio de GitHub.
- [ ] Crear el **primer administrador** (solo funciona mientras no exista ninguno):

  ```bash
  cd /opt/mesa && sudo docker compose -p mesa -f docker-compose.prod.yml --env-file stack.env --env-file images.env \
    run --rm api dist/scripts/bootstrap-admin.js ana.lopez@neitek.com "Ana López"
  ```

  Imprime un enlace de un solo uso (24 h) al host de agentes. La persona define su contraseña y configura MFA al entrar. Los demás usuarios se invitan desde la aplicación.

## Costos esperados

Dentro de *Always Free* (2 OCPU / 12 GB A1, 150 GB de bloque, buckets < 10 GB por nivel, Vault DEFAULT, Bastion, Cloud Guard, escaneo de vulnerabilidades): **~US$0–5/mes**, más Cloudflare (Free $0 / Pro ~$20–25). El presupuesto de OCI avisa al 50 %, 80 % y 100 %.
