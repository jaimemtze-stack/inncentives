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
3. **Correo (fase 0: SMTP):**
   - Crea el buzón compartido `soporte@` en Microsoft 365.
   - Para el SMTP de la fase 0, habilita *SMTP AUTH* solo para ese buzón, con una contraseña de aplicación.
   - La fase 1 cambia a Microsoft Graph con *RBAC for Applications* y desactiva SMTP AUTH.
   - Publica SPF, DKIM y DMARC (`p=quarantine`) del dominio.
4. **GitHub:** crea un *fine-grained token* de solo lectura del repositorio (Contents: read) y Packages: read, con caducidad de 90 días.

## 6. Secretos en OCI Vault

```bash
infra/scripts/bootstrap-secrets.sh <compartment_id> <vault_id> <master_key_id> > secrets.map
```

El script genera las contraseñas aleatorias, te pide las credenciales del paso 5 sin mostrarlas en pantalla y produce `secrets.map` (nombres + OCIDs, **sin valores**).

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
