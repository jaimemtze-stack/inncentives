"""Builds the internal technical manual (architecture and operation).

    python3 build_tecnico.py              # standalone HTML for the repository
    python3 build_tecnico.py --artifact   # page fragment for the published copy

Reuses the visual system of build.py. Diagrams are hand-written inline SVG.
"""
import sys

import build
from build import callout, page, standalone

ARTIFACT = '--artifact' in sys.argv

build.CSS = build.CSS.replace('</style>', r"""
/* Diagrams */
.dg-wrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
.dg { display: block; width: 100%; min-width: 720px; height: auto; color: var(--ink); font-family: var(--font); }
.dg .box { fill: var(--surface); stroke: var(--muted); stroke-width: 1.3; }
.dg .soft { fill: var(--canvas); stroke: var(--line); stroke-width: 1.3; }
.dg .key { fill: var(--gold-soft); stroke: var(--gold); stroke-width: 2; }
.dg .navy { fill: var(--nav); stroke: none; }
.dg .zone { fill: none; stroke: var(--muted); stroke-width: 1.2; stroke-dasharray: 6 5; }
.dg text { fill: currentColor; font-size: 12.5px; }
.dg .b { font-weight: 600; font-size: 13px; }
.dg .m { fill: var(--muted); font-size: 11px; }
.dg .w { fill: #ffffff; }
.dg .zl { fill: var(--muted); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; font-weight: 600; }
.dg .e { fill: none; stroke: currentColor; stroke-width: 1.5; }
.dg .d { stroke-dasharray: 5 4; }
.dg .el { fill: var(--gold-ink); font-size: 11px; font-weight: 600; }
.dg .ah { fill: currentColor; }
.cols { columns: 2 280px; column-gap: 28px; }
.cols li { break-inside: avoid; }
@media print { .dg { min-width: 0; } .dg-wrap { overflow: visible; } }
</style>""")

DEFS = ('<defs><marker id="{id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
        'orient="auto-start-reverse"><path class="ah" d="M0,0 L10,5 L0,10 z"/></marker></defs>')


def diagram(did, w, h, label, caption, inner):
    return (f'<figure><div class="dg-wrap"><svg class="dg" viewBox="0 0 {w} {h}" role="img" aria-label="{label}">'
            f'{DEFS.format(id="a-" + did)}{inner.replace("#A", "#a-" + did)}</svg></div>'
            f'<figcaption>{caption}</figcaption></figure>')


def box(x, y, w, h, title, *lines, cls='box'):
    t = f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="7"/>'
    cx = x + w / 2
    ty = y + 22 if lines else y + h / 2 + 4.5
    tcls = 'b w' if cls == 'navy' else 'b'
    t += f'<text class="{tcls}" x="{cx}" y="{ty}" text-anchor="middle">{title}</text>'
    for i, ln in enumerate(lines):
        mcls = 'm w' if cls == 'navy' else 'm'
        t += f'<text class="{mcls}" x="{cx}" y="{ty + 17 + i * 15}" text-anchor="middle">{ln}</text>'
    return t


def arrow(points, label='', lx=None, ly=None, dashed=False, anchor='middle'):
    pts = ' '.join(f'{x},{y}' for x, y in points)
    t = f'<polyline class="e{" d" if dashed else ""}" points="{pts}" marker-end="url(#A)"/>'
    if label:
        t += f'<text class="el" x="{lx}" y="{ly}" text-anchor="{anchor}">{label}</text>'
    return t


def zone(x, y, w, h, label):
    return (f'<rect class="zone" x="{x}" y="{y}" width="{w}" height="{h}" rx="10"/>'
            f'<text class="zl" x="{x + 12}" y="{y + 18}">{label}</text>')


def table(head, rows):
    th = ''.join(f'<th>{h}</th>' for h in head)
    tr = ''.join('<tr>' + ''.join(f'<td>{c}</td>' for c in r) + '</tr>' for r in rows)
    return f'<div class="tbl"><table><thead><tr>{th}</tr></thead><tbody>{tr}</tbody></table></div>'


# ------------------------------------------------------------------ diagrams
TOPOLOGY = diagram(
    'topo', 1040, 560,
    'Los usuarios llegan por HTTPS a Cloudflare; Cloudflare entrega las peticiones por un túnel que la VM abre hacia afuera; '
    'la VM vive en una subred privada sin IP pública y solo se administra por OCI Bastion.',
    '<b>Topología.</b> No hay puertos abiertos hacia la VM: el túnel lo inicia <code>cloudflared</code> desde adentro. '
    'Object Storage y Vault se alcanzan por el Service Gateway; el resto de la salida (Microsoft 365, GitHub, proveedores) por NAT.',
    box(16, 120, 232, 64, 'Clientes (portal)', 'supportinncentives.neitek.net')
    + box(16, 228, 232, 64, 'Agentes', 'agents-supportinncentives.neitek.net')
    + box(16, 400, 232, 64, 'Operadores', 'llave SSH + sesión de Bastion')
    + box(300, 20, 200, 52, 'DNS neitek.net', 'DigitalOcean (registrar Namecheap)', cls='soft')
    + box(300, 120, 200, 172, 'Cloudflare', 'Custom hostnames (for SaaS)', 'neiteksupport.com → origen', 'TLS · WAF · HSTS', 'Túnel mesa-prod', cls='key')
    + arrow([(400, 72), (400, 120)], 'CNAME', 408, 102, dashed=True, anchor='start')
    + arrow([(248, 152), (300, 168)], 'HTTPS', 274, 150)
    + arrow([(248, 260), (300, 246)], 'HTTPS', 274, 266)
    + zone(540, 20, 484, 520, 'OCI · mx-queretaro-1 · mesa-soporte-prod')
    + zone(560, 64, 296, 340, 'Subred privada 10.40.1.0/24')
    + f'<rect class="soft" x="576" y="96" width="264" height="296" rx="8"/>'
    + '<text class="m" x="708" y="116" text-anchor="middle">VM A1 Flex · 2 OCPU · 12 GB · Ubuntu 24.04</text>'
    + box(596, 128, 224, 38, 'cloudflared')
    + box(596, 178, 224, 38, 'web · nginx :8080')
    + box(596, 228, 224, 38, 'api :3000')
    + box(596, 278, 224, 38, 'jobs · worker')
    + box(596, 328, 224, 50, 'postgres · redis · clamav', '/srv/mesa (volumen 100 GB)')
    + arrow([(708, 166), (708, 178)]) + arrow([(708, 216), (708, 228)]) + arrow([(708, 266), (708, 278)])
    + arrow([(500, 200), (548, 200), (548, 147), (596, 147)])
    + '<text class="el" x="400" y="312" text-anchor="middle">peticiones por el túnel →</text>'
    + '<text class="m" x="400" y="327" text-anchor="middle">(la VM abre la conexión, salida 7844)</text>'
    + box(574, 440, 160, 64, 'OCI Bastion', 'sesión ≤ 3 h · CIDR permitido')
    + arrow([(248, 432), (574, 472)], 'SSH (port forwarding)', 410, 440)
    + arrow([(654, 440), (654, 392)], ':22', 662, 420, anchor='start')
    + box(874, 92, 140, 96, 'Object Storage', 'adjuntos', 'respaldos-pitr', 'respaldos-inmutables')
    + box(874, 206, 140, 56, 'Vault + KMS', 'secretos · llave HSM')
    + box(874, 290, 140, 96, 'Internet (NAT)', 'Microsoft 365', 'GitHub · GHCR', 'Twilio · Meta · Teams', cls='soft')
    + arrow([(840, 140), (874, 140)], 'SGW', 857, 133) + arrow([(840, 234), (874, 234)], 'SGW', 857, 227)
    + arrow([(840, 338), (874, 338)], 'NAT', 857, 331)
)

CONTAINERS = diagram(
    'cont', 1010, 470,
    'cloudflared entrega a nginx y nginx a la API; la API usa PostgreSQL y Redis; jobs y worker consumen las colas de Redis; '
    'jobs envía archivos a ClamAV; los adjuntos van a Object Storage y los mensajes salen a Microsoft 365 y proveedores.',
    '<b>Contenedores.</b> Una misma imagen corre dos procesos: <code>api</code> (HTTP) y <code>jobs</code> (colas y tareas periódicas); ambos leen y escriben en PostgreSQL. '
    'Redis es el punto de encuentro: sesiones, colas BullMQ y el canal de eventos en tiempo real.',
    '<text class="m" x="24" y="26">Redes Docker: edge (cloudflared↔web) · app (web↔api) · data (datos) · egress (única con salida a internet)</text>'
    + box(24, 50, 150, 64, 'cloudflared', 'túnel saliente')
    + box(214, 50, 170, 64, 'web · nginx', 'SPA + proxy :8080')
    + box(424, 50, 180, 64, 'api · NestJS', '/api/v1 · /hooks · /socket.io', cls='key')
    + box(780, 50, 190, 64, 'jobs', 'misma imagen que la API')
    + box(640, 160, 330, 36, 'Redis 7.4 · sesiones · colas BullMQ · eventos')
    + box(424, 250, 180, 64, 'PostgreSQL 16', 'roles app_rw / app_migrator')
    + box(214, 250, 140, 64, 'migrator', 'en cada despliegue', cls='soft')
    + box(780, 250, 190, 64, 'worker', 'correo del sistema')
    + box(780, 340, 190, 54, 'clamav', 'INSTREAM :3310')
    + box(214, 410, 230, 46, 'Object Storage · adjuntos', cls='soft')
    + box(560, 410, 300, 46, 'Microsoft 365 · Twilio · Meta · Teams', cls='soft')
    + arrow([(174, 82), (214, 82)]) + arrow([(384, 82), (424, 82)])
    + arrow([(500, 114), (500, 250)], 'SQL (TLS)', 508, 190, anchor='start')
    + arrow([(590, 114), (680, 160)])
    + arrow([(860, 114), (860, 160)], 'consume', 868, 142, anchor='start')
    + arrow([(875, 196), (875, 250)], 'cola mail', 883, 228, anchor='start')
    + arrow([(970, 82), (992, 82), (992, 367), (970, 367)], 'escaneo', 986, 220, anchor='end')
    + arrow([(354, 282), (424, 282)], 'migra', 389, 274)
    + arrow([(436, 114), (330, 410)], 'URLs firmadas', 362, 372, anchor='end')
    + arrow([(780, 290), (720, 290), (720, 410)], 'envío', 728, 380, anchor='start')
)

PIPELINE = diagram(
    'pipe', 1000, 340,
    'El código pasa por CI y, al llegar a main, el release construye y firma las imágenes; tras la aprobación se publica el manifest. '
    'La VM consulta cada 10 minutos, verifica las firmas, respalda, migra, arranca y revierte si la API no queda sana.',
    '<b>De un PR a producción.</b> GitHub nunca entra al servidor: la VM <i>jala</i> el release aprobado y solo acepta imágenes firmadas '
    'por el workflow de release en <code>main</code>.',
    '<rect class="soft" x="10" y="14" width="980" height="138" rx="10"/><text class="zl" x="24" y="34">GitHub</text>'
    + '<rect class="soft" x="10" y="190" width="980" height="138" rx="10"/><text class="zl" x="24" y="210">VM de producción</text>'
    + box(30, 54, 150, 62, 'PR + CI', 'pruebas · escaneos')
    + box(210, 54, 150, 62, 'merge a main')
    + box(390, 46, 190, 78, 'Release', 'imágenes amd64 + arm64', 'firma cosign · SBOM')
    + box(610, 54, 160, 62, 'Aprobación', 'entorno production', cls='key')
    + box(800, 54, 170, 62, 'GitHub Release', 'manifest.json (digests)')
    + arrow([(180, 85), (210, 85)]) + arrow([(360, 85), (390, 85)]) + arrow([(580, 85), (610, 85)]) + arrow([(770, 85), (800, 85)])
    + box(30, 230, 150, 62, 'mesa-deployer', 'cada 10 min')
    + box(210, 230, 150, 62, 'cosign verify', 'identidad del workflow')
    + box(390, 230, 190, 62, 'pull + respaldo', 'backup.sh incr')
    + box(610, 230, 160, 62, 'migrator + up -d')
    + box(800, 222, 170, 78, 'API sana ≤ 180 s', 'sí: versión actual', 'no: images.env.previous', cls='key')
    + arrow([(180, 261), (210, 261)]) + arrow([(360, 261), (390, 261)]) + arrow([(580, 261), (610, 261)]) + arrow([(770, 261), (800, 261)])
    + arrow([(105, 230), (105, 170), (885, 170), (885, 116)], 'lee el último release aprobado (API de GitHub, token de solo lectura)', 495, 164, dashed=True)
)

BACKUPS = diagram(
    'bak', 1000, 300,
    'PostgreSQL envía WAL continuo y respaldos full y diferenciales a respaldos-pitr con pgBackRest; un volcado diario cifrado con age va al bucket inmutable; '
    'cada camino tiene su script de restauración.',
    '<b>Respaldos.</b> Dos caminos independientes: pgBackRest para recuperar a cualquier minuto (PITR) y un volcado diario cifrado '
    'con una llave cuya parte privada nunca está en el servidor.',
    box(24, 112, 170, 70, 'PostgreSQL 16', '/srv/mesa/pgdata', cls='key')
    + box(260, 30, 210, 72, 'pgBackRest', 'WAL cada ≤ 60 s', 'full dom · diff lun–sáb 02:00')
    + box(260, 192, 210, 72, 'pg_dump diario 03:00', 'cifrado con age', '(solo llave pública)')
    + box(536, 30, 220, 72, 'respaldos-pitr', 'AES-256 · 35 días', 'versionado')
    + box(536, 192, 220, 72, 'respaldos-inmutables', 'WORM 30 días', 'borrado a 90 días')
    + box(820, 30, 160, 72, 'restore.sh', 'PITR · RPO ≤ 5 min', cls='soft')
    + box(820, 192, 160, 72, 'restore-dump.sh', 'base nueva · RPO ≤ 24 h', cls='soft')
    + arrow([(194, 135), (260, 72)]) + arrow([(194, 160), (260, 224)])
    + arrow([(470, 66), (536, 66)], 'S3 compatible', 503, 58)
    + arrow([(470, 228), (536, 228)], '--no-overwrite', 503, 220)
    + arrow([(756, 66), (820, 66)], 'restaurar', 788, 58, dashed=True)
    + arrow([(756, 228), (820, 228)], 'restaurar', 788, 220, dashed=True)
)

# ------------------------------------------------------------------ chapters
C = []

C.append(('resumen', 'Resumen', 'Qué es la mesa de soporte, cómo está construida y dónde vive cada parte.', f"""
<p>La mesa de soporte de Inncentives es un help desk inspirado en Zammad para los clientes de Inncentives. Tiene dos áreas que se distinguen por el host: el <b>Portal de clientes</b> y el <b>área de agentes</b>; cada host tiene su propia cookie de sesión y las rutas de administración solo responden en el host de agentes.</p>
{table(['Área', 'Host en producción', 'Notas'], [
    ['Portal de clientes', '<code>supportinncentives.neitek.net</code>', 'También publica <code>/hooks/*</code> (proveedores) y <code>/widget.js</code>.'],
    ['Agentes', '<code>agents-supportinncentives.neitek.net</code>', 'Rutas de administración y tokens de API solo aquí.'],
])}
{callout('warn', 'Nombres de dominio en la documentación', '<p>La guía de despliegue y algunas integraciones todavía usan los nombres <code>soporte.inncentives.com</code> y <code>agentes.soporte.inncentives.com</code>. Producción usa los hosts de <code>neitek.net</code> de la tabla, configurados en <code>public_hosts</code> de Terraform.</p>')}
<h3>Tecnología</h3>
{table(['Capa', 'Tecnología'], [
    ['Lenguaje', 'TypeScript 5.9 sobre Node.js 22 (pnpm 10, monorepo)'],
    ['API', 'NestJS 11 sobre Fastify 5, validación con Zod, Prisma 6'],
    ['Datos', 'PostgreSQL 16 (imagen propia con pgBackRest y age), Redis 7.4'],
    ['Procesos en segundo plano', 'BullMQ 5 (colas en Redis)'],
    ['Tiempo real', 'Socket.IO 4.8 solo por WebSocket'],
    ['Web', 'React 18, Vite 7, Tailwind 3, TanStack Query y Router, i18next (es/en)'],
    ['Servidor web', 'nginx-unprivileged 1.30 (sustituyó a Caddy, ADR-0001)'],
    ['Imágenes', 'Distroless Node 22 (nonroot) fijada por digest; multi-arquitectura amd64/arm64'],
    ['Pruebas', 'Vitest, Playwright, OWASP ZAP (DAST), pruebas de respaldo y desplegador en shell'],
])}
<h3>Estructura del repositorio</h3>
{table(['Ruta', 'Contenido'], [
    ['<code>packages/shared</code>', 'Esquemas Zod, permisos por rol, catálogo de condiciones de reglas, nombres de colas, tipos de la API.'],
    ['<code>apps/api</code>', 'API NestJS; el mismo código genera el proceso <code>jobs</code>. Esquema y migraciones de Prisma.'],
    ['<code>apps/worker</code>', 'Worker BullMQ del correo del sistema.'],
    ['<code>apps/web</code>', 'SPA de agentes y portal.'],
    ['<code>docker/</code>', '<code>app.Dockerfile</code> multi-target (api, migrator, worker, web), imagen de PostgreSQL, configuración de nginx.'],
    ['<code>deploy/</code>', 'Compose de producción, scripts del servidor (desplegador, respaldos, secretos, métricas) y unidades systemd.'],
    ['<code>infra/</code>', 'Terraform de OCI, cloud-init y <code>bootstrap-secrets.sh</code>.'],
    ['<code>docs/</code>', 'Guía de despliegue, ADRs, seguridad, integraciones, runbooks y manuales.'],
])}"""))

C.append(('topologia', 'Topología y red', 'Cómo llega una petición desde el navegador hasta el contenedor que la atiende.', f"""
{TOPOLOGY}
<h3>Borde: Cloudflare</h3>
<ul>
<li><b>DNS.</b> La zona <code>neitek.net</code> sigue en DigitalOcean (registrar Namecheap). Los dos hosts públicos son CNAME hacia Cloudflare for SaaS, configurado sobre el dominio técnico <code>neiteksupport.com</code> con origen de respaldo <code>origen.neiteksupport.com</code>. Los registros TXT de validación también viven en DigitalOcean.</li>
<li><b>Túnel</b> <code>mesa-prod</code>: entrega ambos hosts a <code>http://web:8080</code>. TLS termina en Cloudflare; dentro del túnel el tráfico llega en HTTP a nginx.</li>
<li><b>IP del cliente.</b> La API solo confía en <code>CF-Connecting-IP</code> cuando la petición viene de nginx (<code>172.30.15.10</code>).</li>
<li><b>Controles previstos</b> (guía de despliegue §8): reglas administradas del WAF, Bot Fight Mode en el portal, regla <i>Skip</i> para <code>/hooks/</code>, límite de 20 peticiones por minuto a <code>/api/v1/auth/*</code>, Always HTTPS, TLS mínimo 1.2 y HSTS, y Cloudflare Access para el host de agentes (grupos de Entra con MFA, <i>Bypass</i> en <code>/hooks/*</code>).</li>
</ul>
<h3>Red en OCI</h3>
{table(['Elemento', 'Configuración'], [
    ['VCN', '<code>10.40.0.0/16</code>; subred privada <code>10.40.1.0/24</code> sin IP pública ni entrada desde internet.'],
    ['Salida', 'NAT Gateway para internet; Service Gateway para los servicios de Oracle (Object Storage, Vault).'],
    ['Security list', 'Se reemplaza la predeterminada por <code>mesa-prod-default-deny</code>. Su única regla es la salida TCP 22 hacia la subred, necesaria para que el endpoint de Bastion alcance la VM.'],
    ['NSG <code>mesa-prod-app-nsg</code>', 'Entrada: solo TCP 22 desde la subred (Bastion). Salida: 443, 80 (apt), 7844 TCP/UDP (túnel), 587, 993, 53/udp, 123/udp y servicios de Oracle.'],
    ['Bastion', '<code>mesa-prod-bastion</code>, lista blanca de CIDR (nunca <code>0.0.0.0/0</code>), sesiones de hasta 3 h.'],
])}
{callout('', 'Acceso de operadores', '<p>Se entra con una sesión de <b>port forwarding</b> de Bastion hacia el puerto 22 de la VM (por ejemplo <code>ssh -N -L 2222:&lt;ip&gt;:22 &lt;sesión&gt;@host.bastion.mx-queretaro-1.oci.oraclecloud.com</code>) y luego <code>ssh -p 2222 ubuntu@localhost</code>. Las llaves públicas autorizadas se instalan desde <code>admin_ssh_public_keys</code> de Terraform.</p>')}"""))

C.append(('contenedores', 'Contenedores', 'La aplicación corre como una pila de Docker Compose, proyecto <code>mesa</code>.', f"""
{CONTAINERS}
{table(['Servicio', 'Imagen', 'Función', 'Límites'], [
    ['cloudflared', '<code>cloudflare/cloudflared:2025.10.0</code>', 'Túnel saliente; token desde archivo.', '256 MB'],
    ['web', 'mesa-web (nginx)', 'Sirve la SPA y hace proxy de <code>/api</code>, <code>/hooks</code> y <code>/socket.io</code>.', '256 MB'],
    ['api', 'mesa-api', 'API HTTP en :3000; healthcheck a <code>/health</code>.', '1 GB'],
    ['jobs', 'mesa-api (<code>dist/jobs-main.js</code>)', 'Colas y tareas periódicas, sin HTTP.', '1 GB'],
    ['worker', 'mesa-worker', 'Correo del sistema por SMTP (Office 365) o Graph.', '512 MB'],
    ['migrator', 'mesa-migrator', '<code>prisma migrate deploy</code>; perfil <code>migrate</code>, solo lo invoca el desplegador.', '—'],
    ['postgres', 'mesa-postgres', 'PostgreSQL 16 con pgBackRest; datos en <code>/srv/mesa/pgdata</code>.', '3 GB'],
    ['redis', '<code>redis:7.4-alpine</code>', 'Sesiones, colas, limitadores, pub/sub; AOF; <code>maxmemory 384mb noeviction</code>.', '512 MB'],
    ['clamav', '<code>clamav/clamav-debian:1.4</code>', 'Antivirus INSTREAM en :3310; perfil <code>default</code>.', '3 GB'],
])}
<h3>Redes Docker</h3>
{table(['Red', 'Subred', 'Uso'], [
    ['edge', '172.30.10.0/24 (interna)', 'cloudflared ↔ web'],
    ['app', '172.30.15.0/24 (interna)', 'web ↔ api; nginx tiene la IP fija 172.30.15.10'],
    ['data', '172.30.20.0/24 (interna)', 'Servicios de datos'],
    ['egress', '172.30.30.0/24', 'Única red con salida: Vault, Object Storage, Microsoft 365, Cloudflare, firmas de ClamAV'],
])}
<h3>Endurecimiento común</h3>
<ul>
<li>Sistema de archivos de solo lectura, <code>no-new-privileges</code>, <code>cap_drop: ALL</code>, usuarios no root y límites de memoria y procesos.</li>
<li>Logs JSON rotados (20 MB × 5).</li>
<li>Secretos como archivos: el tmpfs del host <code>/run/mesa/secrets</code> se monta en cada contenedor como <code>/run/secrets</code>. En producción la aplicación rechaza secretos por variable de entorno.</li>
<li>Imágenes propias fijadas por digest en <code>/opt/mesa/images.env</code>; las de terceros (cloudflared, redis, clamav) por tag.</li>
</ul>"""))

C.append(('aplicacion', 'La aplicación', 'Cómo está organizada la API y qué mecanismos protegen cada petición.', f"""
<h3>Arranque</h3>
<p>Fastify con límite de cuerpo de 1 MB, <code>trustProxy</code> y helmet. Prefijo global <code>/api/v1</code>, salvo <code>/health</code>, <code>/ready</code> y los webhooks de proveedores (<code>/hooks/cti</code>, <code>/hooks/azure-devops</code>, <code>/hooks/twilio/*</code>, <code>/hooks/whatsapp</code>). Respuestas con <code>Cache-Control: no-store</code>. La especificación OpenAPI está en <code>/api/v1/openapi.json</code> (requiere sesión de agente).</p>
<h3>Módulos de la API</h3>
<ul class="cols">
<li><b>auth</b>: login, MFA TOTP, WebAuthn, SSO OIDC.</li>
<li><b>policy</b>: guardia global de autorización.</li>
<li><b>security</b>: contraseñas, sesiones, tokens, cifrado de campos, rate limit.</li>
<li><b>tickets</b>: tickets, artículos, macros, numeración.</li>
<li><b>attachments</b> y <b>storage</b>: adjuntos en OCI u S3.</li>
<li><b>automation</b>, <b>rules</b>, <b>sla</b>: triggers, SLA, Core Workflows.</li>
<li><b>overviews</b> y <b>search</b>: vistas y búsqueda.</li>
<li><b>channels</b>: correo, teléfono, WhatsApp/SMS, Twilio.</li>
<li><b>chat</b>: chat en vivo.</li>
<li><b>kb</b>: base de conocimiento bilingüe.</li>
<li><b>notifications</b> y <b>mail</b>: avisos in-app y correo.</li>
<li><b>realtime</b> y <b>events</b>: Socket.IO y bus de eventos.</li>
<li><b>reports</b>: métricas y exportación.</li>
<li><b>integrations</b>: Inncentives, Azure DevOps, Teams.</li>
<li><b>ai</b>: asistente para agentes.</li>
<li><b>privacy</b>: ARCO, retención, datos sensibles.</li>
<li><b>audit</b>: bitácora encadenada.</li>
<li><b>admin</b> y <b>config-admin</b>: usuarios, organizaciones, configuración, tokens, ver como cliente.</li>
<li><b>jobs</b> y <b>queue</b>: procesos en segundo plano.</li>
<li><b>health</b>, <b>settings</b>, <b>openapi</b>, <b>common</b>.</li>
</ul>
<h3>Sesiones y autenticación</h3>
{table(['Mecanismo', 'Detalle'], [
    ['Cookie', '<code>__Host-sid</code> de 256 bits, Secure, HttpOnly, SameSite=Lax, una por host. Redis guarda solo el SHA-256.'],
    ['Expiración', '30 min de inactividad, 12 h absoluta; el identificador rota al completar MFA y al cambiar la contraseña.'],
    ['CSRF', 'Origin/Referer exacto + <code>Sec-Fetch-Site</code>, y token <code>X-CSRF-Token</code> por sesión.'],
    ['Contraseñas', 'Argon2id (19 MiB, t=2), mínimo 12 caracteres, verificación de filtraciones (HIBP, k-anonymity).'],
    ['MFA', 'Obligatorio para ADMIN y AGENT. TOTP con anti-replay y semilla cifrada; WebAuthn/passkeys; códigos de recuperación.'],
    ['SSO OIDC', 'Code + PKCE; solo identidades vinculadas por el propio usuario; Entra ID para agentes.'],
    ['Reautenticación', 'Acciones sensibles piden contraseña de nuevo (<code>@RequireReauth</code>).'],
    ['Tokens de API', 'Personales, solo personal y host de agentes; se guarda el hash; vigencia ≤ 365 días.'],
])}
<h3>Autorización</h3>
<p>Denegar por defecto: cada ruta declara <code>@Public()</code> o <code>@RequirePermissions()</code>. Los permisos salen del rol (ADMIN, AGENT, CUSTOMER) más roles personalizados. El alcance por objeto lo da el acceso a grupos del agente o la organización del cliente; lo que queda fuera de alcance responde 404.</p>
<h3>Otros mecanismos</h3>
<ul>
<li><b>Límites de frecuencia</b> en Redis: por ejemplo 5 intentos de login por cuenta cada 15 min, 30 por IP, y límites de subida, descarga y IA.</li>
<li><b>Bitácora</b>: cada registro guarda el hash del anterior (SHA-256); un trigger de la base impide modificar o borrar, y el rol de la aplicación no tiene esos permisos.</li>
<li><b>Tiempo real</b>: Socket.IO autenticado con la misma cookie; los eventos son mínimos (<code>{{type, ticketId}}</code>) y viajan por el canal Redis <code>mesa:events</code>.</li>
<li><b>Búsqueda</b>: texto completo de PostgreSQL (columna generada con índice GIN, español, inglés y sin acentos).</li>
<li><b>Reglas como datos</b>: condiciones JSON validadas contra un catálogo cerrado (máx. 60 nodos, 4 niveles); control de bucles en triggers.</li>
<li><b>Adjuntos</b>: lista blanca de tipos con verificación de bytes reales, 25 MB, escaneo con ClamAV antes de permitir descarga, URL firmada de 60 s, vistas previas recodificadas sin EXIF.</li>
<li><b>Datos sensibles</b>: detector de RFC, CURP, NSS, CLABE, tarjetas y sueldos en texto y archivos; aviso al cliente y redacción por el agente.</li>
</ul>
<h3>Canales e integraciones</h3>
{table(['Integración', 'Cómo funciona'], [
    ['Correo entrante', 'Microsoft Graph o IMAP cada minuto. Solo se confía en <code>Authentication-Results</code> del servidor configurado; sin <i>pass</i> el ticket va a «Por verificar». Hilos por cabeceras y por <code>[Ticket#…]</code>.'],
    ['Correo saliente', 'Respuestas de tickets: cola <code>outbound</code> en <code>jobs</code>. Correo del sistema: cola <code>mail</code> en <code>worker</code> (SMTP STARTTLS u Graph).'],
    ['Teléfono, WhatsApp, SMS', 'Webhooks firmados (Twilio, Meta, CTI con HMAC y anti-replay); deduplicación por id externo.'],
    ['Chat en vivo', 'Cada chat es un ticket del canal chat; latido de disponibilidad de 90 s; cierre por inactividad.'],
    ['Inncentives', 'Barra lateral (modo off/mock/http, caché 60 s) y widget <code>/widget.js</code> con JWT de un solo uso.'],
    ['Azure DevOps, Teams, webhooks', 'Work items sincronizados cada 15 min; avisos a Teams; webhooks con protección SSRF y registro de entregas.'],
    ['IA', 'Desactivada por defecto en dos niveles; redacción previa de datos; nunca envía adjuntos; solo sugiere.'],
])}"""))

C.append(('procesos', 'Procesos en segundo plano', 'Lo que no ocurre dentro de una petición HTTP corre en <code>jobs</code> o en <code>worker</code>.', f"""
{table(['Cola', 'Proceso', 'Qué hace'], [
    ['<code>outbound</code>', 'jobs', 'Envía cada respuesta por correo, WhatsApp o SMS.'],
    ['<code>webhooks</code>', 'jobs', 'Webhooks de triggers y avisos a Teams (5 intentos).'],
    ['<code>scan</code>', 'jobs', 'Antivirus y datos sensibles de adjuntos nuevos.'],
    ['<code>maintenance</code>', 'jobs', 'Tareas periódicas (tabla siguiente).'],
    ['<code>mail</code>', 'worker', 'Invitaciones, restablecimiento de contraseña y notificaciones.'],
])}
{table(['Tarea periódica', 'Frecuencia'], [
    ['Correo entrante, SLA, pendientes, planificadores, privacidad, cierre de chats inactivos', 'cada minuto'],
    ['Sincronización con Azure DevOps', 'cada 15 min'],
    ['Limpieza (adjuntos sin usar, etc.)', 'cada hora'],
    ['Retención de datos', 'cada 6 h'],
])}
<p>Los trabajos tienen 8 intentos con espera exponencial (desde 30 s); los completados se borran a las 24 h y los fallidos a los 7 días.</p>"""))

C.append(('datos', 'Datos', 'PostgreSQL es la fuente de verdad; Redis guarda estado efímero y colas.', f"""
{table(['Dominio', 'Modelos principales'], [
    ['Identidad y acceso', 'Organization, User, Invitation, CustomRole, UserIdentity (SSO), WebAuthnCredential, ApiToken, RecoveryCode'],
    ['Soporte', 'Group, GroupAccess, TicketPriority, SupportPlan, Signature, BusinessCalendar, Sla, SlaTarget'],
    ['Tickets', 'Ticket, Article, Attachment, TicketTag, TicketLink, TicketHistory, Mention, Subscription, SharedDraft, ChecklistItem, TimeEntry'],
    ['Reglas y productividad', 'Trigger, Scheduler, Overview, CoreWorkflow, Macro, TextModule, TicketTemplate, ObjectAttribute'],
    ['Canales', 'EmailChannel, PostmasterFilter, InboundMessage, CallLog, MessagingChannel, ChatSession'],
    ['Privacidad y sistema', 'AuditLog, Notification, DataPrivacyTask, RetentionPolicy, AppSetting'],
    ['Integraciones', 'Webhook, WebhookDelivery, DevOpsLink, TeamsChannel'],
    ['Base de conocimiento', 'KbCategory, KbAnswer, KbTranslation, KbTranslationVersion'],
])}
<h3>Roles de base de datos</h3>
<ul>
<li><code>app_migrator</code>: dueño del esquema; solo lo usa el contenedor <code>migrator</code>.</li>
<li><code>app_rw</code>: la aplicación; solo SELECT, INSERT, UPDATE y DELETE, máximo 40 conexiones.</li>
<li>Conexiones solo por TLS (<code>hostssl</code>) con <code>scram-sha-256</code>.</li>
</ul>
<h3>Migraciones</h3>
<p>Prisma Migrate, aplicadas por el desplegador antes de levantar la nueva versión. Política expand/contract: una reversión de imágenes no deshace el esquema, así que cada migración debe ser compatible con la versión anterior (ADR-0008).</p>
<h3>Redis</h3>
<p>Sesiones (solo hashes), límites de frecuencia, valores de un solo uso (TOTP, OIDC, WebAuthn, CTI), colas BullMQ, pub/sub de eventos y presencia. Persistencia AOF cada segundo.</p>"""))

C.append(('infraestructura', 'Infraestructura en OCI', 'Todo se crea con Terraform (<code>infra/terraform</code>, proveedor oracle/oci 9.x).', f"""
{table(['Recurso', 'Configuración'], [
    ['Región y compartimento', '<code>mx-queretaro-1</code> (la validación solo admite regiones de México); compartimento <code>mesa-soporte-prod</code>.'],
    ['Instancia', '<code>mesa-prod-app</code>: VM.Standard.A1.Flex, 2 OCPU, 12 GB, Ubuntu 24.04 aarch64, solo IMDSv2, red paravirtualizada.'],
    ['Discos', 'Arranque 50 GB; datos 100 GB en <code>/srv/mesa</code> (XFS, <code>prevent_destroy</code>), ambos cifrados con la llave maestra.'],
    ['Vault', '<code>mesa-prod-vault</code> con llave <code>mesa-prod-master-key</code> (AES-256 en HSM). Terraform nunca crea valores de secretos.'],
    ['IAM', 'Grupo dinámico <code>mesa-prod-vm</code> (instance principal) con permisos mínimos; usuario de servicio de pgBackRest solo para <code>respaldos-pitr</code>; grupos humanos de infraestructura y auditoría.'],
    ['Seguridad', 'Cloud Guard, Security Zone (Maximum Security), escaneo semanal de vulnerabilidades del host.'],
    ['Observabilidad', 'Topic <code>mesa-prod-alerts</code>; alarmas de CPU, memoria, disco, respaldo fallido, falta de latido y aplicación no sana; logs del host y de <code>/var/log/mesa</code> por 90 días.'],
    ['Estado de Terraform', 'Backend OCI, bucket <code>mesa-terraform-state</code>, clave <code>mesa-soporte/prod.tfstate</code>.'],
])}
<h3>Buckets</h3>
{table(['Bucket', 'Uso', 'Retención'], [
    ['<code>adjuntos</code>', 'Archivos de tickets', 'Versionado; versiones previas se borran a 14 días'],
    ['<code>respaldos-pitr</code>', 'Repositorio de pgBackRest', 'Versionado; versiones previas se borran a 14 días'],
    ['<code>respaldos-inmutables</code>', 'Volcados diarios cifrados', 'Regla WORM de 30 días (se bloquea a mano tras la primera prueba de restauración); borrado a 90 días'],
])}
<h3>Arranque de la VM (cloud-init)</h3>
<p>Instala Docker y Compose, age, jq, auditd, actualizaciones automáticas, OCI CLI y cosign verificado; endurece sshd, sysctl y Docker; prepara el tmpfs de secretos y el volumen de datos; y deja en <code>/opt/mesa</code> el compose, los scripts y las unidades systemd. Los cambios de cloud-init requieren reemplazar la instancia (<code>terraform plan -replace=oci_core_instance.app</code>), porque <code>metadata</code> está en <code>ignore_changes</code>.</p>
{callout('warn', 'Capacidad de A1', '<p>Si OCI responde «Out of host capacity» al crear la instancia, se reintenta el <code>apply</code> en un ciclo hasta que haya capacidad.</p>')}"""))

C.append(('despliegue', 'Integración y despliegue', 'Del pull request a producción sin que GitHub tenga acceso al servidor.', f"""
{PIPELINE}
<h3>CI (en cada PR y en main)</h3>
{table(['Job', 'Qué valida'], [
    ['Lint, types, unit tests, build', 'ESLint, Prettier, TypeScript, Vitest y build.'],
    ['Integration and browser tests', 'PostgreSQL y Redis reales, almacenamiento S3 y correo de prueba; pruebas de integración y Playwright.'],
    ['Backup/PITR, deployer, secrets…', 'shellcheck, pruebas del desplegador y de secretos, respaldo y PITR reales, smoke de la pila de producción con OWASP ZAP.'],
    ['Secrets, SAST, dependencies, IaC…', 'gitleaks, Semgrep, <code>pnpm audit</code>, Trivy sobre IaC e imágenes.'],
    ['Terraform', '<code>fmt</code>, <code>validate</code> y tflint.'],
    ['linux/arm64 build and smoke test', 'Solo en main: build y smoke en arm64 con QEMU.'],
])}
<h3>Release</h3>
<p>En cada push a main: reutiliza la CI, construye las cinco imágenes (api, migrator, worker, web, postgres) para amd64 y arm64 con SBOM y procedencia, las publica en GHCR y las firma con cosign keyless. Tras la aprobación del entorno <code>production</code> publica el release <code>mesa-vAAAA.MM.DD-N</code> con <code>manifest.json</code>.</p>
<h3>Desplegador en la VM</h3>
<p><code>mesa-deployer.timer</code> corre cada 10 minutos. Usa <code>github_read_token</code> (lectura del repositorio) y <code>ghcr_read_token</code> (<code>read:packages</code>). Solo acepta imágenes fijadas por digest y firmadas por el workflow de release en <code>main</code>. El estado queda en <code>/var/lib/mesa/deploy/</code> y el log en <code>/var/log/mesa/deployer.log</code>.</p>
<h3>Unidades systemd</h3>
{table(['Unidad', 'Cuándo', 'Qué hace'], [
    ['<code>mesa-secrets-sync</code>', 'al arrancar', 'Copia los secretos de Vault al tmpfs.'],
    ['<code>mesa-stack</code>', 'al arrancar', 'Levanta la pila con <code>stack.env</code> e <code>images.env</code>.'],
    ['<code>mesa-deployer.timer</code>', 'cada 10 min', 'Instala el último release aprobado.'],
    ['<code>mesa-backup-full.timer</code>', 'domingo 02:00', 'Respaldo completo de pgBackRest.'],
    ['<code>mesa-backup-diff.timer</code>', 'lun–sáb 02:00', 'Respaldo diferencial.'],
    ['<code>mesa-backup-check.timer</code>', 'cada hora', 'Verifica el archivado de WAL.'],
    ['<code>mesa-dump.timer</code>', 'diario 03:00', 'Volcado cifrado al bucket inmutable.'],
    ['<code>mesa-report.timer</code>', 'cada 5 min', 'Métricas: latido, disco, salud de la aplicación.'],
    ['<code>mesa-alert@</code>', 'al fallar otra unidad', 'Publica la alerta en el topic de OCI.'],
])}"""))

C.append(('respaldos', 'Respaldos y recuperación', 'Objetivos: RPO ≤ 5 min (≤ 24 h con el volcado inmutable) y RTO ≤ 4 h.', f"""
{BACKUPS}
{table(['Escenario', 'Procedimiento'], [
    ['A. Error humano', 'PITR con <code>restore.sh --time "&lt;fecha&gt;"</code>; los datos actuales se mueven a <code>/srv/mesa/pgdata.before-restore-&lt;fecha&gt;</code>, nunca se borran.'],
    ['B. Pérdida del servidor', '<code>terraform apply</code>, secretos, desplegador y <code>restore.sh --latest --yes</code>.'],
    ['C. Servidor comprometido', 'Restaurar el volcado inmutable desde un equipo limpio con <code>restore-dump.sh</code> a una base nueva.'],
    ['D. Prueba trimestral', 'Obligatoria; también se prueba en CI en cada cambio.'],
])}
{callout('warn', 'Llave de age', '<p>El servidor solo tiene la llave <b>pública</b> (<code>/opt/mesa/backup-age-recipient.txt</code>). La privada vive en el gestor de contraseñas y en un sobre sellado; sin ella el volcado inmutable no se puede abrir.</p>')}
<p>Detalle completo: <code>docs/runbooks/restauracion.md</code> y ADR-0009.</p>"""))

C.append(('seguridad', 'Seguridad', 'Controles transversales y decisiones de arquitectura.', f"""
<h3>Secretos</h3>
<ol class="steps">
<li><code>infra/scripts/bootstrap-secrets.sh</code> genera los valores aleatorios, pide los externos y los guarda en OCI Vault; produce <code>secrets.map</code> (nombres y OCID, sin valores).</li>
<li><code>secrets.map</code> se instala en <code>/opt/mesa/secrets.map</code>.</li>
<li><code>mesa-secrets-sync</code> lee Vault con el instance principal y escribe archivos 0400 en el tmpfs <code>/run/mesa/secrets</code>.</li>
<li>Un secreto con valor <code>unused</code> deja su integración desactivada. Rotación: <code>docs/runbooks/rotacion-secretos.md</code>.</li>
</ol>
<h3>Cifrado</h3>
<ul>
<li><b>En reposo</b>: llave HSM para volúmenes y buckets; pgBackRest cifrado; age en volcados; AES-256-GCM por campo para semillas TOTP, URLs de Teams y similares (con rotación por id de llave).</li>
<li><b>En tránsito</b>: Cloudflare y túnel; PostgreSQL con TLS dentro de Docker; SMTP con STARTTLS. El cifrado en tránsito del volumen no está disponible en A1.</li>
</ul>
<h3>Navegador</h3>
<p>CSP estricta (<code>script-src 'self'</code>, sin estilos ni scripts en línea, <code>frame-ancestors 'none'</code>), HSTS de 2 años, <code>nosniff</code>, Permissions-Policy restrictiva, COOP y CORP <code>same-origin</code>.</p>
<h3>Gobierno</h3>
<ul>
<li>Modelo de amenazas STRIDE con 55 amenazas, mitigación y prueba: <code>docs/seguridad/modelo-amenazas.md</code>.</li>
<li>OWASP ASVS 4.0 nivel 2: <code>docs/seguridad/matriz-asvs.md</code>.</li>
<li>Respuesta a incidentes (triage ≤ 1 h, LFPDPPP): <code>docs/seguridad/respuesta-incidentes.md</code>.</li>
<li>Riesgos aceptados: un solo servidor sin alta disponibilidad, certificado autofirmado de PostgreSQL interno, llave de larga duración de pgBackRest, detectores por patrones (datos sensibles e IA), <code>img-src https:</code> en la CSP.</li>
</ul>
<h3>Decisiones de arquitectura (ADR)</h3>
{table(['ADR', 'Tema'], [
    ['0001', 'Stack tecnológico'], ['0002', 'Autorización «denegar por defecto»'], ['0003', 'Sesiones en servidor, cookies por host y CSRF'],
    ['0004', 'Almacenamiento de archivos'], ['0005', 'Secretos como archivos desde OCI Vault'], ['0006', 'Correo saliente por cola'],
    ['0007', 'Infraestructura en OCI México'], ['0008', 'Despliegue pull con firmas verificadas'], ['0009', 'Respaldos y recuperación'],
    ['0010', 'Bases efímeras para pruebas'], ['0011', 'Reglas como datos'], ['0012', 'Canal de correo'],
    ['0013', 'Adjuntos, antivirus y datos sensibles'], ['0014', 'Tiempo real, tokens de API y ver como cliente'], ['0015', 'Base de conocimiento bilingüe'],
    ['0016', 'Reportes y exportación'], ['0017', 'Azure DevOps, Teams y webhooks'], ['0018', 'SSO OIDC y WebAuthn'],
    ['0019', 'API de Inncentives y widget'], ['0020', 'Telefonía, WhatsApp y SMS'], ['0021', 'Chat en vivo'], ['0022', 'IA para agentes'],
])}"""))

C.append(('operacion', 'Operación', 'Archivos, comandos y verificaciones del día a día en el servidor.', f"""
<h3>Archivos en la VM</h3>
{table(['Ruta', 'Contenido'], [
    ['<code>/opt/mesa/stack.env</code>', 'Hosts, región y namespace de OCI, remitente de correo y opciones de Graph.'],
    ['<code>/opt/mesa/images.env</code>', 'Imágenes por digest de la versión actual (y <code>.previous</code>).'],
    ['<code>/opt/mesa/deployer.env</code>', 'Repositorio, rutas y topic de alertas del desplegador.'],
    ['<code>/opt/mesa/secrets.map</code>', 'Nombres y OCID de los secretos.'],
    ['<code>/opt/mesa/scripts/</code>', 'Desplegador, respaldos, restauración, secretos y métricas.'],
    ['<code>/run/mesa/secrets</code>', 'Secretos en memoria (tmpfs).'],
    ['<code>/srv/mesa/</code>', 'Volumen de datos: <code>pgdata</code>, <code>redis</code>, <code>clamav</code>.'],
    ['<code>/var/lib/mesa/deploy/</code>', 'Versión actual e historial de despliegues.'],
    ['<code>/var/log/mesa/</code>', 'Logs del desplegador, respaldos y secretos.'],
])}
<h3>Comandos frecuentes</h3>
{table(['Para', 'Comando'], [
    ['Ver contenedores', '<code>sudo docker ps --format \'{{{{.Names}}}}  {{{{.Status}}}}\'</code>'],
    ['Logs de un servicio', '<code>cd /opt/mesa &amp;&amp; sudo docker compose -p mesa -f docker-compose.prod.yml --env-file stack.env --env-file images.env logs -f api</code>'],
    ['Reiniciar la pila', '<code>sudo systemctl restart mesa-stack</code>'],
    ['Desplegar ahora', '<code>sudo systemctl start mesa-deployer</code> (o <code>deployer.sh --force</code>)'],
    ['Versión instalada', '<code>cat /var/lib/mesa/deploy/current-version</code>'],
    ['Respaldos', '<code>sudo /opt/mesa/scripts/backup.sh full|diff|incr|check|info</code>'],
    ['Temporizadores', '<code>systemctl list-timers \'mesa-*\'</code> (deben aparecer 6)'],
    ['Primer administrador', '<code>… run --rm api dist/scripts/bootstrap-admin.js &lt;correo&gt; "&lt;Nombre&gt;"</code>'],
])}
<h3>Salud</h3>
<p><code>GET /health</code> (proceso vivo) y <code>GET /ready</code> (base de datos y Redis), sin prefijo <code>/api/v1</code>. <code>mesa-report</code> publica <code>app_healthy</code> y el latido cada 5 minutos; las alarmas avisan al topic <code>mesa-prod-alerts</code>.</p>
<h3>Runbooks</h3>
<ul>
<li><code>docs/despliegue.md</code>: aprovisionamiento completo.</li>
<li><code>docs/runbooks/restauracion.md</code>: restauración de PostgreSQL.</li>
<li><code>docs/runbooks/rotacion-secretos.md</code>: rotación (tokens de GitHub y llave de pgBackRest cada 90 días; SMTP 180; resto anual).</li>
<li><code>docs/seguridad/respuesta-incidentes.md</code>.</li>
</ul>"""))

C.append(('estado', 'Estado de producción', 'Lo que difiere de la guía de despliegue y lo que queda pendiente, al 20 de octubre de 2026.', f"""
<h3>Diferencias con la guía de despliegue</h3>
<ul>
<li>Hosts en <code>neitek.net</code> con DNS en DigitalOcean y Cloudflare for SaaS (dominio técnico <code>neiteksupport.com</code>), en lugar de una zona propia en Cloudflare.</li>
<li>Acceso de operadores por port forwarding de Bastion con llaves en <code>admin_ssh_public_keys</code>; la security list lleva la salida TCP 22 hacia la subred.</li>
<li>El aprovisionamiento se hizo desde Windows (OCI CLI en un venv, Git Bash para <code>bootstrap-secrets.sh</code>).</li>
</ul>
<h3>Pendientes</h3>
<ul>
<li>Actualizar <code>docs/despliegue.md</code> con las diferencias anteriores.</li>
<li>Configurar el correo de Microsoft 365 (envío del sistema y buzones de entrada). Mientras tanto, las invitaciones se generan con un token manual desde el servidor.</li>
<li>Completar en Cloudflare el WAF, el límite de autenticación y Cloudflare Access para el host de agentes.</li>
<li>Configuración inicial de la aplicación (§9 bis de la guía).</li>
<li>Bloquear la regla WORM de <code>respaldos-inmutables</code> después de la primera prueba de restauración.</li>
</ul>"""))

INTRO = ('Arquitectura, infraestructura, despliegue, seguridad y operación de la mesa de soporte de Inncentives, '
         'para el equipo técnico de Neitek.')
TECH = [('tecnico', 'Manual técnico', 'Uso interno')]


def main():
    links = {'tecnico': '#inicio'}
    html = page('tecnico', 'Manual técnico', 'Uso interno · Neitek', INTRO, 'equipo técnico de Neitek', C, links,
                manuals=TECH, eyebrow='Soporte Inncentives · Documentación interna',
                footer='Documento interno de Neitek. Fuente: el repositorio <code>mesa-soporte</code> (docs, ADRs, Terraform, compose y scripts) '
                       'y el registro de la puesta en marcha. Si algo cambia, actualiza <code>docs/manuales/build_tecnico.py</code>.',
                meta_extra='<span><b>Clasificación:</b> uso interno</span>')
    html = html.replace('<title>Manual técnico Inncentives</title>', '<title>Manual técnico de la mesa de soporte</title>')
    (build.OUT / 'manual-tecnico.html').write_text(html if ARTIFACT else standalone(html), encoding='utf-8')
    print('ok')


if __name__ == '__main__':
    main()
