"""Builds the illustrated user manuals (cliente, agente, administrador).

    python3 build.py              # standalone HTML files for the repository
    python3 build.py --artifact   # page fragments with links to the published copies

The screenshots in img/ come from the web app with sample data.
"""
import re
import sys
from pathlib import Path

OUT = Path(__file__).parent

CSS = r"""
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Layout: the app's own shell — navy sidebar with the logo and the table of
   contents, cream canvas, white cards, golden-yellow highlights. */
:root {
  --canvas: #fbfaf6; --surface: #ffffff; --line: #e7e4d8; --ink: #2a2a12; --muted: #6b6758;
  --nav: #2d2e82; --nav-hover: #3a3c94; --nav-text: #bfc1de;
  --gold: #fbc52a; --gold-soft: #fffbeb; --gold-line: #fde68a; --gold-ink: #8a5d0a;
  --orange: #ee7d11; --note: #fef3c7; --note-line: #f2d27a;
  --ok-bg: #dcfce7; --ok-ink: #166534; --warn-bg: #fef3c7; --warn-ink: #78350f;
  --new-bg: #e6e7f5; --new-ink: #25266d; --gray-bg: #e7e4d8; --gray-ink: #3d3a2c;
  --red-bg: #fee2e2; --red-ink: #991b1b;
  --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --canvas: #171610; --surface: #232118; --line: #3d3a2c; --ink: #f4f2ea; --muted: #a7a290;
  --nav: #22236a; --nav-hover: #3a3c94; --nav-text: #bfc1de;
  --gold-soft: #2c2410; --gold-line: #5c3d06; --gold-ink: #fcd34d;
  --note: #2f2712; --note-line: #5c3d06;
  --ok-bg: #14321f; --ok-ink: #86efac; --warn-bg: #3a2a0c; --warn-ink: #fcd34d;
  --new-bg: #25266d; --new-ink: #e6e7f5; --gray-bg: #3d3a2c; --gray-ink: #e7e4d8;
  --red-bg: #3b1414; --red-ink: #fca5a5; color-scheme: dark; } }
:root[data-theme="dark"] {
  --canvas: #171610; --surface: #232118; --line: #3d3a2c; --ink: #f4f2ea; --muted: #a7a290;
  --nav: #22236a; --nav-hover: #3a3c94; --nav-text: #bfc1de;
  --gold-soft: #2c2410; --gold-line: #5c3d06; --gold-ink: #fcd34d;
  --note: #2f2712; --note-line: #5c3d06;
  --ok-bg: #14321f; --ok-ink: #86efac; --warn-bg: #3a2a0c; --warn-ink: #fcd34d;
  --new-bg: #25266d; --new-ink: #e6e7f5; --gray-bg: #3d3a2c; --gray-ink: #e7e4d8;
  --red-bg: #3b1414; --red-ink: #fca5a5; color-scheme: dark; }

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 16px; }
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
body { margin: 0; background: var(--canvas); color: var(--ink); font-family: var(--font); font-size: 15.5px; line-height: 1.6; }
.shell { display: grid; grid-template-columns: 288px minmax(0, 1fr); min-height: 100vh; }

/* Sidebar */
.side { background: var(--nav); color: var(--nav-text); position: sticky; top: 0; height: 100vh; overflow-y: auto;
  padding: 20px 14px 28px max(14px, env(safe-area-inset-left, 0px)); display: flex; flex-direction: column; gap: 6px; }
.logo { background: #fff; border-radius: 8px; padding: 12px 14px; display: block; }
.logo img { display: block; width: 100%; height: auto; }
.side .area { font-size: 12.5px; padding: 6px 10px 0; color: var(--nav-text); }
.side .manual-name { color: #fff; font-weight: 600; font-size: 15px; padding: 0 10px 8px; }
.side h2 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--nav-text); margin: 14px 10px 4px; font-weight: 600; }
.side nav a { display: flex; gap: 10px; align-items: baseline; color: var(--nav-text); text-decoration: none; font-size: 14px;
  padding: 7px 10px; border-radius: 6px; }
.side nav a:hover, .side nav a:focus-visible { background: var(--nav-hover); color: #fff; outline: none; }
.side nav a .n { font-size: 11.5px; color: #8f92c4; min-width: 1.6em; font-variant-numeric: tabular-nums; }
.side .others { margin-top: auto; border-top: 1px solid var(--nav-hover); padding-top: 12px; display: grid; gap: 2px; }
.side .others a { color: var(--nav-text); font-size: 13.5px; padding: 6px 10px; border-radius: 6px; text-decoration: none; }
.side .others a:hover { background: var(--nav-hover); color: #fff; }
.side .others a[aria-current="page"] { background: var(--nav-hover); color: var(--gold); box-shadow: inset 3px 0 0 var(--gold); }

/* Main column */
main { overflow-wrap: anywhere; padding-block: 40px 64px; padding-left: max(16px, min(5vw, 56px)); padding-right: max(16px, env(safe-area-inset-right, 0px), min(5vw, 56px)); }
.wrap { max-width: 860px; }
.cover { border-top: 8px solid var(--gold); background: linear-gradient(180deg, var(--gold-soft), var(--surface)); border-radius: 10px;
  border-left: 1px solid var(--line); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 32px 32px 28px; margin-bottom: 36px; }
.cover .eyebrow { font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--gold-ink); font-weight: 600; }
.cover h1 { font-size: clamp(30px, 4.4vw, 42px); line-height: 1.12; margin: 8px 0 12px; letter-spacing: -0.02em; text-wrap: balance; }
.cover h1 em { font-style: normal; color: var(--gold-ink); }
.cover p { margin: 0; max-width: 62ch; color: var(--muted); font-size: 16.5px; }
.meta { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-top: 18px; font-size: 13px; color: var(--muted); }
.meta b { color: var(--ink); font-weight: 600; }

section.chapter { padding-top: 12px; margin-bottom: 44px; }
.chapter > h2 { font-size: 25px; letter-spacing: -0.01em; margin: 0 0 6px; display: flex; gap: 12px; align-items: baseline; text-wrap: balance; }
.chapter > h2 .num { color: var(--gold-ink); font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; }
.chapter > .lead { color: var(--muted); margin: 0 0 18px; max-width: 66ch; }
h3 { font-size: 18px; margin: 28px 0 8px; }
h4 { font-size: 15px; margin: 18px 0 6px; }
p, li { max-width: 68ch; }
a { color: var(--gold-ink); }
ol.steps { counter-reset: step; list-style: none; padding: 0; margin: 12px 0 18px; display: grid; gap: 10px; }
ol.steps > li { counter-increment: step; position: relative; padding-left: 42px; }
ol.steps > li::before { content: counter(step); position: absolute; left: 0; top: 1px; width: 28px; height: 28px; border-radius: 50%;
  background: var(--gold); color: #2a2a12; font-weight: 700; font-size: 13.5px; display: grid; place-items: center; }
ul { padding-left: 1.2em; }
ul li { margin: 4px 0; }

/* UI vocabulary */
.ui { font-weight: 600; background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 0 6px; font-size: .94em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.btn { font-weight: 600; background: var(--gold); color: #2a2a12; border-radius: 5px; padding: 1px 8px; font-size: .92em; -webkit-box-decoration-break: clone; box-decoration-break: clone; }
.path { font-weight: 600; }
.path::before { content: "▸ "; color: var(--gold-ink); }
kbd { font-family: var(--mono); font-size: .85em; border: 1px solid var(--line); border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; background: var(--surface); }
code { font-family: var(--mono); font-size: .86em; background: var(--gray-bg); color: var(--gray-ink); border-radius: 4px; padding: 1px 5px; }
.chip { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 12.5px; font-weight: 500; white-space: nowrap; }
.chip.new { background: var(--new-bg); color: var(--new-ink); }
.chip.open { background: var(--warn-bg); color: var(--warn-ink); }
.chip.pend { background: var(--gray-bg); color: var(--gray-ink); }
.chip.done { background: var(--ok-bg); color: var(--ok-ink); }
.chip.merged { background: var(--gray-bg); color: var(--muted); }
.chip.sla-warn { background: #f59e0b; color: #000; border-radius: 4px; font-weight: 600; }
.chip.sla-bad { background: #b91c1c; color: #fff; border-radius: 4px; font-weight: 600; }
.chip.internal { background: var(--note); color: var(--warn-ink); border-radius: 4px; }

/* Callouts */
.callout { border: 1px solid var(--line); border-left: 4px solid var(--gold); background: var(--surface); border-radius: 8px; padding: 12px 16px; margin: 16px 0; max-width: 72ch; }
.callout b.t { display: block; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--gold-ink); margin-bottom: 2px; }
.callout.warn { border-left-color: var(--orange); background: var(--gold-soft); }
.callout.warn b.t { color: var(--orange); }
.callout p { margin: 4px 0; }

/* Figures */
figure { margin: 18px 0 24px; }
figure .frame { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 6px; box-shadow: 0 1px 2px rgba(42,42,18,.06); }
figure img { display: block; width: 100%; height: auto; border-radius: 6px; }
figcaption { font-size: 13px; color: var(--muted); margin-top: 8px; }
figcaption b { color: var(--ink); }

/* Tables */
.tbl { overflow-x: auto; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); margin: 14px 0 22px; }
table { width: 100%; border-collapse: collapse; font-size: 14.5px; }
th { text-align: left; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 600;
  padding: 10px 14px; border-bottom: 1px solid var(--line); background: var(--canvas); }
td { padding: 9px 14px; border-bottom: 1px solid var(--line); vertical-align: top; }
tr:last-child td { border-bottom: 0; }
td:first-child { font-weight: 600; white-space: nowrap; }
.yes { color: var(--ok-ink); font-weight: 600; } .no { color: var(--muted); }

.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin: 14px 0 20px; }
.tile { background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.tile h4 { margin: 0 0 4px; font-size: 15px; }
.tile p { margin: 0; font-size: 14px; color: var(--muted); }
footer.end { border-top: 1px solid var(--line); margin-top: 48px; padding-top: 16px; font-size: 13px; color: var(--muted); }

@media (max-width: 900px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .side, main { min-width: 0; }
  .side { position: static; height: auto; padding: 16px max(16px, env(safe-area-inset-right, 0px)) 16px max(16px, env(safe-area-inset-left, 0px)); }
  .side nav { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .logo { max-width: 260px; }
  .cover { padding: 24px 20px; }
}
@media print {
  .side { display: none; } .shell { display: block; } main { padding: 0; }
  .chapter { break-before: page; } figure, .callout, .tbl { break-inside: avoid; }
  h2, h3, h4, .lead, .callout b.t { break-after: avoid; break-inside: avoid; }
  p, li { orphans: 3; widows: 3; }
  .tile, ol.steps > li { break-inside: avoid; }
  figure .frame { width: fit-content; max-width: 100%; margin-inline: auto; }
  figure img { width: auto; max-width: 100%; max-height: 190mm; }
  figcaption { text-align: center; }
  td:first-child { white-space: normal; }
  body { font-size: 11pt; }
}
</style>
"""

MANUALS = [
    ('cliente', 'Manual del cliente', 'Portal de clientes'),
    ('agente', 'Manual del agente', 'Mesa de soporte — Agentes'),
    ('administrador', 'Manual del administrador', 'Mesa de soporte — Agentes'),
]


def fig(img, caption):
    return (f'<figure><div class="frame"><img src="img/{img}.jpg" alt="{re.sub("<[^>]+>", "", caption)}" loading="lazy"></div>'
            f'<figcaption>{caption}</figcaption></figure>')


def callout(kind, title, body):
    return f'<div class="callout {kind}"><b class="t">{title}</b>{body}</div>'


FOOTER = ('Soporte Inncentives · Neitek. Las pantallas de este manual usan datos de ejemplo; los nombres de vistas, '
          'grupos y campos pueden variar según la configuración de tu mesa de soporte.')


def page(slug, title, area, intro, audience, chapters, links, manuals=None,
         eyebrow='Soporte Inncentives · Guía de uso', footer=FOOTER, version='1.0 · octubre 2026',
         meta_extra='<span><b>Idioma de las pantallas:</b> español (México)</span>'):
    manuals = manuals or MANUALS
    head, _, last = title.rpartition(' ')
    toc = ''.join(f'<a href="#{cid}"><span class="n">{i:02d}</span><span>{name}</span></a>'
                  for i, (cid, name, _lead, _body) in enumerate(chapters, 1))
    others = ''.join(
        f'<a href="{links.get(s, "#")}"{" aria-current=\"page\"" if s == slug else ""}>{t}</a>' for s, t, _ in manuals)
    body = ''.join(
        f'<section class="chapter" id="{cid}"><h2><span class="num">{i:02d}</span>{name}</h2>'
        f'<p class="lead">{lead}</p>{content}</section>'
        for i, (cid, name, lead, content) in enumerate(chapters, 1))
    return f"""<title>{title} Inncentives</title>
<meta name="claude:viewport-fit-sides" content="cover">
{CSS}
<div class="shell">
  <aside class="side">
    <a class="logo" href="#inicio"><img src="img/logo.png" alt="Inncentives"></a>
    <div class="area">{area}</div>
    <div class="manual-name">{title}</div>
    <h2>Contenido</h2>
    <nav aria-label="Contenido">{toc}</nav>
    <div class="others"><h2 style="margin-top:0">Manuales</h2>{others}</div>
  </aside>
  <main id="inicio">
    <div class="wrap">
      <header class="cover">
        <div class="eyebrow">{eyebrow}</div>
        <h1>{head} <em>{last}</em></h1>
        <p>{intro}</p>
        <div class="meta"><span><b>Para:</b> {audience}</span><span><b>Versión:</b> {version}</span>{meta_extra}</div>
      </header>
      {body}
      <footer class="end">{footer}</footer>
    </div>
  </main>
</div>
"""


STATES_TABLE = """
<div class="tbl"><table>
<thead><tr><th>Estado</th><th>Qué significa</th></tr></thead><tbody>
<tr><td><span class="chip new">Nuevo</span></td><td>El ticket se acaba de crear y nadie lo ha trabajado todavía.</td></tr>
<tr><td><span class="chip open">Abierto</span></td><td>El equipo de soporte está trabajando en él.</td></tr>
<tr><td><span class="chip pend">Pendiente (recordatorio)</span></td><td>En espera de algo (por ejemplo, información del cliente) hasta una fecha; ese día vuelve a la bandeja del agente.</td></tr>
<tr><td><span class="chip pend">Pendiente de cierre</span></td><td>Se cerrará solo en la fecha indicada si nadie responde.</td></tr>
<tr><td><span class="chip done">Resuelto</span></td><td>Se dio una solución; si respondes, el ticket se reactiva.</td></tr>
<tr><td><span class="chip done">Cerrado</span></td><td>El caso terminó.</td></tr>
<tr><td><span class="chip merged">Fusionado</span></td><td>Se unió con otro ticket del mismo caso; la conversación sigue en el otro.</td></tr>
</tbody></table></div>"""

ATTACH = callout('', 'Adjuntos', '<p>Puedes adjuntar archivos de hasta <b>25 MB</b> cada uno. Todos pasan por un antivirus: mientras se analizan verás <span class="ui">Analizando…</span>, y solo se pueden descargar cuando están limpios. Un archivo con virus queda <span class="ui">En cuarentena</span>.</p>')

ACCOUNT_COMMON = f"""
<h3>Cambiar tu contraseña</h3>
<ol class="steps">
<li>Abre <span class="path">Mi cuenta</span> en la parte de abajo del menú.</li>
<li>En <b>Cambiar contraseña</b> escribe tu <span class="ui">Contraseña actual</span> y la <span class="ui">Nueva contraseña</span> (mínimo 12 caracteres; una frase fácil de recordar funciona bien).</li>
<li>Pulsa <span class="btn">Cambiar contraseña</span>. Por seguridad se cierran tus otras sesiones abiertas.</li>
</ol>
<h3>Sesiones activas</h3>
<p>La tabla <b>Sesiones activas</b> muestra desde qué navegador e IP has entrado. La fila marcada <span class="ui">Esta sesión</span> es la actual. Si ves una sesión que no reconoces, pulsa <span class="ui">Cerrar</span> en esa fila o <span class="ui">Cerrar las demás sesiones</span> y cambia tu contraseña.</p>
<h3>Llaves de seguridad y passkeys</h3>
<p>Puedes entrar con la huella, el rostro o una llave física en lugar del código de 6 dígitos. Escribe un nombre (por ejemplo «Laptop») y pulsa <span class="ui">Agregar llave</span>; tu navegador te guiará. Para quitar una llave, pulsa <span class="ui">Cerrar</span> junto a ella.</p>
<h3>Códigos de recuperación</h3>
<p>Si perdiste los códigos que guardaste al activar la verificación en dos pasos, pulsa <span class="ui">Generar nuevos códigos de recuperación</span>. Los anteriores dejan de servir. Cada código funciona una sola vez.</p>
{callout('', 'Confirmar tu contraseña', '<p>Algunas acciones sensibles muestran <b>«Confirma tu contraseña para continuar»</b>. Escríbela y pulsa <span class="ui">Confirmar</span>; es una protección por si alguien más usa tu computadora.</p>')}
"""

LOGIN_STEPS = """
<ol class="steps">
<li>Abre la dirección de tu mesa de soporte en el navegador.</li>
<li>Escribe tu <span class="ui">Correo electrónico</span> y tu <span class="ui">Contraseña</span> y pulsa <span class="btn">Entrar</span>.</li>
<li>Si tienes activada la verificación en dos pasos, escribe el <span class="ui">Código de 6 dígitos</span> que muestra tu app de autenticación y pulsa <span class="btn">Verificar</span>. También puedes usar tu llave o passkey, o un código de recuperación (<span class="ui">Usar un código de recuperación</span>).</li>
</ol>"""

FORGOT = """
<h3>Si olvidaste tu contraseña</h3>
<ol class="steps">
<li>En la pantalla de inicio pulsa <span class="ui">¿Olvidaste tu contraseña?</span>.</li>
<li>Escribe tu correo y pulsa <span class="btn">Enviar enlace</span>. Por seguridad siempre verás el mismo mensaje, exista o no la cuenta.</li>
<li>Abre el enlace del correo, escribe tu <span class="ui">Nueva contraseña</span>, confírmala y pulsa <span class="btn">Cambiar contraseña</span>.</li>
</ol>"""

MFA_SETUP = """
<h3>Configurar la verificación en dos pasos</h3>
<ol class="steps">
<li>Instala una app de autenticación en tu teléfono (Microsoft Authenticator, Google Authenticator, 1Password u otra).</li>
<li>En la pantalla <b>Configura la verificación en dos pasos</b>, escanea el código QR con la app. Si no puedes escanearlo, captura la clave que aparece debajo.</li>
<li>Escribe el código de 6 dígitos que muestra la app y pulsa <span class="btn">Activar</span>. Si prefieres, usa <span class="ui">Usar una llave de seguridad o passkey en su lugar</span>.</li>
<li>Aparecerán tus <b>códigos de recuperación</b>. Guárdalos en un lugar seguro (por ejemplo, tu gestor de contraseñas): no se volverán a mostrar. Pulsa <span class="btn">Ya los guardé</span>.</li>
</ol>"""

SHORTCUTS = """
<div class="tbl"><table><thead><tr><th>Tecla</th><th>Qué hace</th></tr></thead><tbody>
<tr><td><kbd>/</kbd></td><td>Lleva el cursor al buscador de tickets.</td></tr>
<tr><td><kbd>n</kbd></td><td>Abre un ticket nuevo.</td></tr>
<tr><td><kbd>r</kbd></td><td>Lleva el cursor al cuadro <b>Mensaje</b> para responder el ticket abierto.</td></tr>
</tbody></table></div>
<p>Los atajos no funcionan mientras escribes en un campo ni si tienes presionada <kbd>Ctrl</kbd>, <kbd>Alt</kbd> o <kbd>Cmd</kbd>.</p>"""

# ------------------------------------------------------------------ cliente
cliente = [
    ('acceso', 'Entrar al portal',
     'Tu cuenta se crea con una invitación. Después entras con tu correo y contraseña.',
     f"""
<h3>Activar tu cuenta</h3>
<ol class="steps">
<li>Recibirás un correo de invitación de Soporte Inncentives. Abre el enlace; la página se titula <b>Activa tu cuenta</b> y muestra tu correo y tu organización.</li>
<li>Revisa tu <span class="ui">Nombre</span>, elige una <span class="ui">Nueva contraseña</span> (mínimo 12 caracteres) y confírmala.</li>
<li>Pulsa <span class="btn">Crear cuenta</span>. Verás «Tu cuenta está lista. Ya puedes iniciar sesión.»</li>
</ol>
{callout('warn', 'El enlace vence', '<p>Si aparece «El enlace no es válido o ya venció», pide al equipo de soporte que te envíe una nueva invitación.</p>')}
<h3>Iniciar sesión</h3>
{fig('portal-login', '<b>Iniciar sesión.</b> Arriba a la derecha puedes cambiar el idioma entre Español e English.')}
{LOGIN_STEPS}
<p>Tu organización puede pedir verificación en dos pasos. Si es así, después de entrar se te pedirá configurarla; sigue los pasos de la sección <a href="#cuenta">Mi cuenta</a>.</p>
{FORGOT}"""),
    ('portal', 'Conoce el portal',
     'El menú azul de la izquierda te lleva a todo lo que necesitas.',
     f"""
{fig('portal-tickets', '<b>Inicio del portal.</b> Menú a la izquierda, buscador arriba y tus tickets agrupados por día.')}
<div class="grid2">
<div class="tile"><h4>Tickets</h4><p>Tus solicitudes de soporte: crear, consultar y responder.</p></div>
<div class="tile"><h4>Chat</h4><p>Conversación en vivo con un agente cuando hay alguien disponible.</p></div>
<div class="tile"><h4>Base de conocimiento</h4><p>Respuestas a las dudas más frecuentes, para resolver por tu cuenta.</p></div>
<div class="tile"><h4>Mi cuenta</h4><p>Contraseña, sesiones y métodos de acceso.</p></div>
</div>
<p>Abajo del menú también están el selector de <b>idioma</b> y <span class="ui">Cerrar sesión</span>. En teléfonos, el menú se abre con el botón ☰ de la esquina superior.</p>"""),
    ('tickets', 'Consultar tus tickets',
     'Cada solicitud es un ticket con un número, un estado y su conversación.',
     f"""
<h3>Vistas</h3>
<p>Arriba de la lista hay pestañas con un contador. Normalmente verás:</p>
<ul>
<li><b>Mis tickets abiertos</b>: lo que está en curso.</li>
<li><b>Mis tickets cerrados</b>: tu historial.</li>
<li><b>Abiertos de mi organización</b>: los tickets de tus compañeros, solo si tu cuenta tiene ese permiso.</li>
</ul>
<p>La lista agrupa los tickets por el día de su última actualización (<b>Hoy</b>, <b>Ayer</b> o la fecha). Debajo de cada título verás el número (por ejemplo <code>#20261001</code>) y el grupo que lo atiende. Pulsa el título para abrirlo.</p>
<h3>Buscar</h3>
<p>Escribe en el buscador de arriba y pulsa <span class="ui">Buscar tickets</span>. Puedes buscar por texto o por número, por ejemplo <code>#20261001</code>. El resultado también muestra artículos de la base de conocimiento que coinciden.</p>
<h3>Estados de un ticket</h3>
{STATES_TABLE}"""),
    ('nuevo', 'Crear un ticket',
     'Describe tu caso con el mayor detalle posible: así el equipo lo resuelve más rápido.',
     f"""
{fig('portal-new', '<b>Nuevo ticket.</b> El aviso de privacidad aparece arriba; los campos con * son obligatorios.')}
<ol class="steps">
<li>Pulsa el botón amarillo <span class="btn">+</span> junto al buscador (o la tecla <kbd>n</kbd>).</li>
<li>Escribe un <span class="ui">Título</span> breve. Al escribir aparecen sugerencias de la base de conocimiento bajo «Quizá esto te ayude:»; revísalas, tal vez ya esté la respuesta.</li>
<li>En <span class="ui">Mensaje</span> explica qué pasó, qué esperabas y desde cuándo ocurre.</li>
<li>Completa <b>Datos del caso</b> (por ejemplo, el <span class="ui">Módulo de Inncentives</span>). Los marcados con * son obligatorios.</li>
<li>Si tienes capturas o archivos, agrégalos en <span class="ui">Adjuntar archivos</span>.</li>
<li>Pulsa <span class="btn">Crear ticket</span>. Recibirás el número del ticket y la confirmación por correo.</li>
</ol>
{callout('warn', 'Protege los datos de tus empleados', '<p>No escribas RFC, CURP, NSS, CLABE ni sueldos. Si el sistema detecta datos de ese tipo, te mostrará «Tu mensaje parece contener datos de empleados… Por favor anonimízalos antes de enviarlo». Puedes corregir el texto o, si es indispensable, confirmar el envío.</p>')}
{ATTACH}
<h3>Reportar un problema desde Inncentives</h3>
<p>Dentro de Inncentives puede haber un botón para reportar un problema. Abre la página <b>Reportar un problema</b> con los datos de la pantalla donde estabas (ambiente, módulo, versión, URL y hora), así no tienes que escribirlos.</p>
<ol class="steps">
<li>Escribe el <span class="ui">Título</span> y el <span class="ui">Mensaje</span>. Puedes pegar una captura con <kbd>Ctrl</kbd>+<kbd>V</kbd> dentro del mensaje.</li>
<li>Adjunta archivos si hace falta y pulsa <span class="btn">Enviar reporte</span>.</li>
</ol>"""),
    ('seguimiento', 'Dar seguimiento y responder',
     'Toda la conversación del ticket queda en un solo lugar.',
     f"""
{fig('portal-zoom', '<b>Detalle del ticket.</b> Arriba el número, el estado y el botón para cerrarlo; abajo el cuadro para responder.')}
<ol class="steps">
<li>Abre el ticket desde la lista. Verás los mensajes en orden, con quién los escribió y cuándo.</li>
<li>Para descargar un adjunto, pulsa <span class="ui">Descargar</span> junto al nombre del archivo.</li>
<li>Para contestar, escribe en <span class="ui">Mensaje</span> (o usa la tecla <kbd>r</kbd>), agrega archivos si lo necesitas y pulsa <span class="btn">Enviar</span>.</li>
</ol>
<p>También puedes responder desde tu correo: contesta el correo de notificación y tu mensaje se agrega al mismo ticket.</p>
<h3>Cerrar un ticket</h3>
<p>Si tu caso ya quedó resuelto, pulsa <span class="ui">Cerrar ticket</span>. Este botón solo aparece si tu mesa de soporte lo permite.</p>
{callout('', 'Si un ticket resuelto vuelve a fallar', '<p>Responde en el mismo ticket: se reactiva y el equipo lo verá de nuevo. Si el ticket ya estaba cerrado, según la configuración se reabre o se crea uno nuevo enlazado.</p>')}"""),
    ('chat', 'Chat en vivo',
     'Para dudas rápidas, conversa en tiempo real con un agente.',
     f"""
{fig('portal-chat', '<b>Chat en vivo.</b> Si no hay agentes disponibles, el portal te ofrece crear un ticket.')}
<ol class="steps">
<li>Abre <span class="path">Chat</span> en el menú.</li>
<li>Escribe tu pregunta en <span class="ui">¿En qué te ayudamos?</span> y pulsa <span class="btn">Iniciar chat</span>.</li>
<li>Verás «Esperando a que un agente se una…». Cuando el agente entre, escribe en <span class="ui">Mensaje</span> y pulsa <span class="btn">Enviar</span>.</li>
<li>Al terminar, pulsa <span class="ui">Terminar chat</span>.</li>
</ol>
<p>Cada chat queda guardado como un ticket, así que puedes consultarlo después en tu lista.</p>
<p>Si aparece «No hay agentes disponibles en este momento», usa el botón <span class="ui">Nuevo ticket</span> y te responderemos por esa vía.</p>"""),
    ('kb', 'Base de conocimiento',
     'Respuestas listas a las preguntas más comunes sobre Inncentives.',
     f"""
{fig('portal-kb', '<b>Base de conocimiento.</b> Categorías a la izquierda y buscador arriba.')}
<ul>
<li>Elige una categoría a la izquierda o deja <b>Todas</b>.</li>
<li>Escribe al menos 3 letras en <span class="ui">Buscar en la base de conocimiento</span>.</li>
<li>Abre un artículo para leerlo. Si el artículo existe en inglés, puedes cambiar de idioma con las pestañas <b>Español</b> / <b>English</b>.</li>
</ul>"""),
    ('cuenta', 'Mi cuenta y seguridad',
     'Mantén tu acceso protegido.',
     f"""
{fig('portal-account', '<b>Mi cuenta.</b> Contraseña, sesiones y llaves de acceso.')}
{MFA_SETUP}
{ACCOUNT_COMMON}"""),
    ('ayuda', 'Atajos y dudas frecuentes',
     'Pequeños trucos para moverte más rápido.',
     f"""
<h3>Atajos de teclado</h3>
{SHORTCUTS}
<h3>Dudas frecuentes</h3>
<h4>No veo los tickets de mis compañeros</h4>
<p>La vista <b>Abiertos de mi organización</b> solo aparece si tu cuenta tiene ese acceso. Pídelo al equipo de soporte.</p>
<h4>No me llegan los correos</h4>
<p>Revisa la carpeta de correo no deseado y agrega la dirección de soporte a tus contactos.</p>
<h4>Perdí mi teléfono con la app de autenticación</h4>
<p>Entra con uno de tus códigos de recuperación (<span class="ui">Usar un código de recuperación</span>) y después configura la app en el nuevo teléfono. Si tampoco tienes los códigos, contacta al equipo de soporte.</p>"""),
]

# ------------------------------------------------------------------ agente
SEARCH = """
<div class="tbl"><table><thead><tr><th>Escribe</th><th>Encuentra</th></tr></thead><tbody>
<tr><td><code>recibos bonos</code></td><td>Tickets que contienen esas palabras.</td></tr>
<tr><td><code>#20261001</code></td><td>El ticket con ese número.</td></tr>
<tr><td><code>state:open</code> · <code>estado:open</code></td><td>Por estado (new, open, pending_reminder, pending_close, resolved, closed).</td></tr>
<tr><td><code>owner:me</code> · <code>propietario:yo</code></td><td>Tickets asignados a ti.</td></tr>
<tr><td><code>org:"ACME"</code> · <code>organizacion:"ACME"</code></td><td>Por organización del cliente.</td></tr>
<tr><td><code>grupo:Nómina</code> · <code>group:Nómina</code></td><td>Por grupo.</td></tr>
<tr><td><code>tag:calculo</code> · <code>etiqueta:calculo</code></td><td>Por etiqueta.</td></tr>
</tbody></table></div>
<p>Puedes combinarlos: <code>recibos org:"ACME" state:open</code>. Además de tickets, la búsqueda muestra artículos de la base de conocimiento, personas y organizaciones.</p>"""

agente = [
    ('acceso', 'Acceso y seguridad',
     'Las cuentas del equipo de soporte siempre usan verificación en dos pasos.',
     f"""
<h3>Activar tu cuenta</h3>
<p>Recibirás una invitación por correo. Abre el enlace, escribe tu nombre y una contraseña de al menos 12 caracteres y pulsa <span class="btn">Crear cuenta</span>.</p>
<h3>Iniciar sesión</h3>
{fig('login', '<b>Iniciar sesión</b> en el área de agentes.')}
{LOGIN_STEPS}
{MFA_SETUP}
{callout('warn', 'Obligatorio para agentes', '<p>La verificación en dos pasos es obligatoria para agentes y administradores. La primera vez que entres, la aplicación te llevará directamente a configurarla.</p>')}
{FORGOT}"""),
    ('interfaz', 'La pantalla de trabajo',
     'El menú de la izquierda agrupa las funciones en Soporte, Analizar y Administrar.',
     f"""
{fig('agent-tickets', '<b>Inicio del agente.</b> Menú, buscador con el botón de nuevo ticket, vistas y lista agrupada por día.')}
<div class="tbl"><table><thead><tr><th>Sección</th><th>Opciones</th></tr></thead><tbody>
<tr><td>Soporte</td><td>Tickets, Chat, Teléfono, Base de conocimiento.</td></tr>
<tr><td>Analizar</td><td>Reportes y Tiempo.</td></tr>
<tr><td>Administrar</td><td>Organizaciones y Configuración (para un agente, solo la pestaña de Tokens de API).</td></tr>
<tr><td>Abajo</td><td>Notificaciones, Mi cuenta, idioma y Cerrar sesión.</td></tr>
</tbody></table></div>
<h3>Notificaciones</h3>
<p>La campana muestra un contador con lo que no has leído (tickets nuevos en tus grupos, asignaciones, respuestas de clientes, menciones, recordatorios y avisos de SLA). Pulsa un aviso para abrir el ticket o <span class="ui">Marcar todas como leídas</span>.</p>
<h3>Atajos de teclado</h3>
{SHORTCUTS}"""),
    ('lista', 'La lista de tickets',
     'Las vistas reúnen los tickets según su situación; la búsqueda encuentra cualquier ticket.',
     f"""
<h3>Vistas</h3>
<p>Las pestañas sobre la lista son las <b>vistas</b>. Las más comunes son <b>Mis tickets</b>, <b>Mis pendientes alcanzados</b>, <b>Sin asignar</b>, <b>Escalados</b>, <b>Todos los abiertos</b>, <b>Por verificar</b> y <b>Mis menciones</b>. Cada una muestra su contador; el administrador puede cambiarlas.</p>
<p>La lista agrupa por día de última actualización y muestra, por ticket: título, número y grupo (con su punto de color), estado, cliente, propietario, prioridad y hora.</p>
<h3>Avisos de SLA</h3>
<p>Junto al título pueden aparecer <span class="chip sla-warn">SLA en riesgo</span> (queda poco tiempo para cumplir el compromiso) o <span class="chip sla-bad">SLA vencido</span> (ya se pasó). El símbolo ⚠ indica que el ticket contiene posibles datos personales.</p>
<h3>Estados</h3>
{STATES_TABLE}
<h3>Buscar</h3>
{SEARCH}
<h3>Cambios en varios tickets a la vez</h3>
<ol class="steps">
<li>Marca las casillas de los tickets (o la casilla del encabezado para seleccionar todos).</li>
<li>En la barra «3 seleccionados» (con tu número de tickets) elige un <span class="ui">Estado…</span>, escribe en <span class="ui">Añadir etiqueta</span> o elige una <span class="ui">Macro…</span>.</li>
<li>Pulsa <span class="btn">Aplicar</span>. Verás cuántos se actualizaron, por ejemplo «3 de 3 actualizados». Cada ticket se valida por separado según tus permisos.</li>
</ol>"""),
    ('crear', 'Registrar un ticket',
     'Usa esta pantalla para llamadas, correos que llegaron por otra vía o notas internas.',
     f"""
{fig('agent-new', '<b>Nuevo ticket</b> (agente): plantilla, cliente, grupo, prioridad, tipo y datos del caso.')}
<ol class="steps">
<li>Pulsa el botón <span class="btn">+</span> (o la tecla <kbd>n</kbd>).</li>
<li>Si hay <span class="ui">Plantilla</span>, elige una para precargar los datos.</li>
<li>En <span class="ui">Buscar cliente (nombre, correo o teléfono)</span> escribe al menos 2 caracteres y elige al cliente. Es obligatorio.</li>
<li>Escribe el <span class="ui">Título</span>, revisa <span class="ui">Grupo</span> y <span class="ui">Prioridad</span> y elige el <span class="ui">Tipo</span>: Llamada (predeterminado), Correo o Nota.</li>
<li>Escribe el <span class="ui">Mensaje</span>, llena <b>Datos del caso</b> y agrega adjuntos si hacen falta.</li>
<li>Pulsa <span class="btn">Crear ticket</span>.</li>
</ol>
{ATTACH}"""),
    ('trabajar', 'Trabajar un ticket',
     'En el detalle del ticket ves la conversación, respondes y actualizas sus datos.',
     f"""
{fig('agent-zoom', '<b>Detalle del ticket.</b> Conversación y respuesta a la izquierda; estado, asignación, etiquetas, lista de verificación, macros y vínculos a la derecha.')}
<h3>Encabezado</h3>
<p>Muestra número, título, estado, prioridad, cliente, organización, fecha y el compromiso «Primera respuesta antes de». Si otro agente tiene abierto el mismo ticket verás «También viendo: …» y, si está escribiendo, «… está escribiendo…».</p>
{callout('warn', 'Remitente sin verificar', '<p>Si el correo llegó de una dirección que no corresponde a un cliente registrado, aparece «Remitente sin verificar». Busca y asocia el cliente correcto antes de responder.</p>')}
<h3>Mensajes</h3>
<p>Cada mensaje indica autor, canal (Correo, Llamada, Nota, Portal, Chat, WhatsApp, SMS) y, si aplica, <span class="chip internal">Nota interna (no visible para el cliente)</span>. En los correos verás el estado de entrega (Enviado, Entregado, Leído, Falló el envío…). Botones disponibles: <span class="ui">Responder</span> y <span class="ui">Responder a todos</span> (correos), <span class="ui">Reenviar</span>, <span class="ui">Citar</span> y <span class="ui">Dividir en ticket nuevo</span>. Si un mensaje contiene datos personales, usa <span class="ui">Redactar datos personales</span>.</p>
<h3>Responder</h3>
<ol class="steps">
<li>Elige el <span class="ui">Tipo</span>: <b>Nota</b> (predeterminado, con la casilla «Nota interna» marcada), <b>Correo</b> (con Para y CC), <b>Llamada</b> (dirección y número) o WhatsApp/SMS si el cliente escribió por ese canal.</li>
<li>Si se registra tiempo, captura <span class="ui">Tiempo (minutos)</span> y la <span class="ui">Actividad</span>.</li>
<li>Escribe en <span class="ui">Mensaje</span>. Para insertar un texto predefinido escribe <code>::</code> seguido del atajo (por ejemplo <code>::saludo</code>) y un espacio.</li>
<li>Opcional: <span class="ui">Insertar de la base de conocimiento</span> (como enlace o contenido) y <span class="ui">Mencionar agentes</span> para avisar a un compañero.</li>
<li>Pulsa <span class="btn">Enviar</span>.</li>
</ol>
{callout('', 'Notas internas', '<p>Una nota con la casilla <b>Nota interna</b> marcada nunca la ve el cliente. Úsala para dejar contexto al equipo. Para contestarle al cliente, desmárcala o usa el tipo Correo.</p>')}
<ul>
<li>Tu borrador se guarda solo en tu navegador. Para compartirlo con un compañero usa <span class="ui">Guardar borrador compartido</span>; él lo recupera con <span class="ui">Cargar borrador compartido</span>.</li>
<li>Si alguien actualiza el ticket mientras escribes, verás un aviso para revisar los cambios antes de enviar.</li>
<li>WhatsApp admite respuestas hasta 24 horas después del último mensaje del cliente; SMS hasta 1600 caracteres. En ambos solo se envía texto.</li>
</ul>
<h3>Panel lateral</h3>
<div class="tbl"><table><thead><tr><th>Bloque</th><th>Para qué sirve</th></tr></thead><tbody>
<tr><td>Estado, Prioridad, Grupo, Propietario</td><td>Cambia los datos y pulsa <span class="btn">Guardar cambios</span>. En estados pendientes aparece «Pendiente hasta».</td></tr>
<tr><td>Campos personalizados</td><td>Datos del caso, como el módulo de Inncentives.</td></tr>
<tr><td>Etiquetas</td><td>Escribe en «Añadir etiqueta» y pulsa Enter; pulsa × para quitar una.</td></tr>
<tr><td>Lista de verificación</td><td>Pasos pendientes del caso; márcalos al terminar o agrega nuevos con <span class="ui">Añadir</span>.</td></tr>
<tr><td>Tiempo contabilizado</td><td>Total de minutos registrados en el ticket.</td></tr>
<tr><td>Seguir / Dejar de seguir</td><td>Recibe avisos de los cambios del ticket.</td></tr>
<tr><td>Macros</td><td>Aplican varias acciones de un clic (por ejemplo, responder y cerrar).</td></tr>
<tr><td>Fusionar en…</td><td>Une este ticket con otro del mismo caso: escribe el ID del ticket destino y pulsa Aplicar.</td></tr>
<tr><td>Tickets relacionados</td><td>Vincula tickets como relacionado (related), padre (parent) o hijo (child).</td></tr>
<tr><td>Azure DevOps</td><td>Crea un work item o vincula uno existente para escalar a desarrollo.</td></tr>
<tr><td>Inncentives</td><td>Consulta procesos con error y bitácora reciente del cliente en Inncentives.</td></tr>
<tr><td>Asistente de IA</td><td>Si está habilitado: resumir, sugerir respuesta y clasificar. Nada se envía sin tu revisión.</td></tr>
<tr><td>Historial</td><td>Todos los cambios del ticket, con quién y cuándo.</td></tr>
</tbody></table></div>"""),
    ('chat', 'Chat en vivo',
     'Atiende a los clientes que inician un chat desde el portal o desde Inncentives.',
     f"""
{fig('agent-chat', '<b>Chat en vivo</b> del agente: disponibilidad y cola de chats.')}
<ol class="steps">
<li>Marca <span class="ui">Disponible para chat</span>. Tu disponibilidad se mantiene mientras tengas la aplicación abierta en cualquier página.</li>
<li>En la lista <b>Chats</b> aparecen los que están <b>En espera</b>. Pulsa <span class="btn">Atender</span>.</li>
<li>Conversa con el cliente; cada chat es también un ticket, así que puedes agregar notas, etiquetas o tiempo.</li>
</ol>
<p>Si cierras la aplicación, en unos 90 segundos dejas de aparecer como disponible.</p>"""),
    ('telefono', 'Teléfono',
     'Encuentra al cliente que llama y registra la llamada.',
     """
<ol class="steps">
<li>Abre <span class="path">Teléfono</span>. Escribe el número en <span class="ui">Buscar por número</span> y pulsa <span class="ui">Buscar tickets</span>.</li>
<li>Verás los clientes con ese número y sus tickets abiertos. Abre el ticket si la llamada es sobre un caso existente.</li>
<li>Si es un caso nuevo, pulsa <span class="ui">Registrar llamada</span> y completa el ticket nuevo (elige al cliente).</li>
</ol>
<p>Cuando hay telefonía conectada, una llamada entrante muestra un aviso «Llamada entrante de …» con acceso directo a la búsqueda. La lista <b>Llamadas recientes</b> se actualiza cada 30 segundos.</p>"""),
    ('kb', 'Base de conocimiento',
     'Consulta artículos para responder más rápido o compártelos con el cliente.',
     f"""
{fig('agent-kb', '<b>Base de conocimiento.</b> Los editores ven además el botón Nueva respuesta y las insignias Borrador e Interna.')}
<ul>
<li>Filtra por categoría o busca con al menos 3 letras.</li>
<li>Los artículos marcados <span class="chip pend">Interna</span> solo los ve el equipo de soporte.</li>
<li>Desde la respuesta de un ticket, usa <span class="ui">Insertar de la base de conocimiento</span> para pegar el enlace o el contenido de un artículo.</li>
</ul>
<p>Para crear o editar artículos necesitas el permiso de edición de la base de conocimiento; el proceso está en el manual del administrador.</p>"""),
    ('analizar', 'Reportes y tiempo',
     'Mide la operación del equipo y el consumo de horas por cliente.',
     f"""
{fig('agent-reports', '<b>Reportes.</b> Filtros, indicadores, gráfica diaria y tablas; exportable a CSV y XLSX.')}
<h3>Reportes</h3>
<ul>
<li>Filtra por <span class="ui">Desde</span>, <span class="ui">Hasta</span>, <span class="ui">Grupo</span> y <span class="ui">Organización</span>.</li>
<li>Indicadores: tickets <b>Creados</b>, <b>Cerrados</b> (con reabiertos), <b>Primera respuesta (mediana)</b> y <b>Cumplimiento de SLA</b>.</li>
<li>La gráfica <b>Tickets por día</b> compara creados y cerrados; pasa el cursor para ver cada día o usa <span class="ui">Ver como tabla</span>.</li>
<li>Tablas: carga por agente y por grupo, módulos más reportados, categorías, tiempo de solución y tiempo por organización.</li>
<li>Descarga los datos con <span class="ui">CSV</span> o <span class="ui">XLSX</span>.</li>
</ul>
<h3>Tiempo por organización</h3>
{fig('agent-time', '<b>Tiempo por organización.</b> La barra muestra el consumo frente a los minutos incluidos en el plan; en rojo cuando se excede.')}
<p>Elige el <span class="ui">Mes</span>. Verás los totales del mes y, por organización, el tiempo registrado, el facturable y lo incluido en su plan de soporte (formato horas:minutos).</p>"""),
    ('clientes', 'Organizaciones e invitaciones',
     'Da de alta a los usuarios de tus clientes.',
     f"""
{fig('admin-orgs', '<b>Organizaciones.</b> Invitar usuario, lista de organizaciones e importación por CSV.')}
<h3>Invitar a un cliente</h3>
<ol class="steps">
<li>Abre <span class="path">Organizaciones</span>.</li>
<li>En <b>Invitar usuario</b> escribe el <span class="ui">Correo electrónico</span> y el <span class="ui">Nombre</span>, deja el <span class="ui">Rol</span> en Cliente y elige la <span class="ui">Organización</span>.</li>
<li>Pulsa <span class="btn">Enviar invitación</span>. El cliente recibe un correo para activar su cuenta.</li>
</ol>
<h3>Importar usuarios desde CSV</h3>
<ol class="steps">
<li>En <b>Importar desde CSV</b> elige el <span class="ui">Tipo</span> <b>Usuarios</b> y el archivo. Columnas: correo, nombre, organizacion y rol; separador coma o punto y coma.</li>
<li>Pulsa <span class="ui">Validar (sin guardar)</span>. Si hay errores se listan por fila y campo; corrígelos en el archivo.</li>
<li>Cuando la validación quede sin errores, pulsa <span class="btn">Importar</span>. Cada usuario recibe su invitación.</li>
</ol>"""),
    ('cuenta', 'Mi cuenta',
     'Seguridad, avisos por correo y ausencias.',
     f"""
{fig('agent-account', '<b>Mi cuenta</b> del agente, con la sección Notificaciones y ausencia.')}
<h3>Notificaciones por correo</h3>
<p>En <b>Notificaciones y ausencia</b> marca qué avisos quieres recibir por correo: ticket nuevo en mis grupos, ticket asignado a mí, respuesta del cliente, cambios en tickets que sigo, menciones, recordatorios pendientes, SLA en riesgo y SLA vencido. Pulsa <span class="btn">Guardar</span>.</p>
<h3>Ausencia</h3>
<p>Marca <span class="ui">Estoy fuera de la oficina</span>, indica <span class="ui">Hasta</span> qué fecha y el <span class="ui">ID del agente sustituto</span>, y pulsa <span class="btn">Guardar</span>.</p>
<h3>Tokens de API</h3>
<p>Si necesitas conectar otra herramienta, en <span class="path">Configuración</span> → <b>Tokens de API</b> crea un token con nombre, permisos y vigencia (1 a 365 días). Cópialo en ese momento: no se vuelve a mostrar. Usa <span class="ui">Eliminar</span> para revocarlo.</p>
{ACCOUNT_COMMON}"""),
]

# ------------------------------------------------------------------ administrador
CONFIG_TABLE = """
<div class="tbl"><table><thead><tr><th>Pestaña</th><th>Qué configuras</th></tr></thead><tbody>
<tr><td>Grupos</td><td>Colas de trabajo: correo del grupo, firma, qué pasa con una respuesta a un ticket cerrado (reabrir o crear uno nuevo) y asignación automática.</td></tr>
<tr><td>Prioridades</td><td>Nombre, orden (1 = más alta) y cuál es la predeterminada.</td></tr>
<tr><td>Roles</td><td>Roles personalizados que suman permisos al personal (nunca a clientes).</td></tr>
<tr><td>Planes de soporte</td><td>Minutos incluidos al mes y tarifa por hora en MXN.</td></tr>
<tr><td>Firmas</td><td>Texto de firma de los correos, con variables como <code>{{agent.name}}</code>.</td></tr>
<tr><td>Calendarios</td><td>Zona horaria, horario laboral por día, días inhábiles propios y descansos obligatorios de la LFT.</td></tr>
<tr><td>SLAs</td><td>A qué tickets aplica, calendario, pausa en pendiente, aviso al llegar a cierto % y tiempos de primera respuesta, actualización y solución por prioridad.</td></tr>
<tr><td>Triggers</td><td>Reglas que se ejecutan al crear o actualizar un ticket.</td></tr>
<tr><td>Planificadores</td><td>Reglas que se ejecutan cada cierto tiempo (mínimo 10 minutos) sobre los tickets que cumplen las condiciones.</td></tr>
<tr><td>Core Workflows</td><td>Por pantalla (alta o edición, agente o cliente): qué campos se ven, son obligatorios o de solo lectura, sus valores permitidos y su valor inicial.</td></tr>
<tr><td>Macros</td><td>Conjuntos de acciones de un clic, limitados a ciertos grupos.</td></tr>
<tr><td>Módulos de texto</td><td>Textos que los agentes insertan con <code>::atajo</code>.</td></tr>
<tr><td>Plantillas</td><td>Valores precargados para tickets nuevos.</td></tr>
<tr><td>Vistas</td><td>Pestañas de la lista de tickets: condiciones, columnas, orden y para qué roles.</td></tr>
<tr><td>Campos personalizados</td><td>Campos de ticket, usuario u organización: tipo, opciones, obligatoriedad y si el cliente los ve o edita.</td></tr>
<tr><td>Tipos de actividad</td><td>Catálogo para el registro de tiempo.</td></tr>
<tr><td>Canales de correo</td><td>Buzones de Microsoft 365 (Graph) o IMAP/SMTP que se convierten en tickets.</td></tr>
<tr><td>Filtros postmaster</td><td>Reglas por encabezado del correo: ignorar, marcar como spam o asignar grupo, prioridad y etiquetas.</td></tr>
<tr><td>Webhooks</td><td>Llamadas a sistemas externos; incluye el registro de <b>Entregas</b>.</td></tr>
<tr><td>Canales de Teams</td><td>Avisos a canales de Microsoft Teams por evento; incluye <b>Entregas</b>.</td></tr>
<tr><td>WhatsApp y SMS</td><td>Números de WhatsApp Business o Twilio y el grupo que los atiende.</td></tr>
<tr><td>Retención</td><td>Cuántos días se conserva cada tipo de dato (solo se editan; no se crean ni eliminan).</td></tr>
</tbody></table></div>"""

administrador = [
    ('rol', 'Tu rol',
     'El administrador hace todo lo que hace un agente y, además, configura la mesa de soporte.',
     f"""
<p>Para el trabajo diario con tickets, chat, teléfono y reportes, consulta el <b>Manual del agente</b>. Este manual cubre lo exclusivo del administrador.</p>
{fig('admin-tickets', '<b>Menú del administrador.</b> Además de lo del agente, tiene Configuración completa y Bitácora de auditoría.')}
<div class="tbl"><table><thead><tr><th>Función</th><th>Administrador</th><th>Agente</th><th>Cliente</th></tr></thead><tbody>
<tr><td>Tickets</td><td class="yes">Todos sus grupos</td><td class="yes">Sus grupos</td><td>Propios (y de su organización si se le permite)</td></tr>
<tr><td>Reportes y Tiempo</td><td class="yes">Sí</td><td class="yes">Sí</td><td class="no">No</td></tr>
<tr><td>Editar la base de conocimiento</td><td class="yes">Sí</td><td class="no">No*</td><td class="no">No</td></tr>
<tr><td>Crear organizaciones</td><td class="yes">Sí</td><td class="no">No</td><td class="no">No</td></tr>
<tr><td>Invitar usuarios</td><td class="yes">Cualquier rol</td><td>Solo clientes</td><td class="no">No</td></tr>
<tr><td>Editar usuarios, cambiar su rol y restablecer su verificación</td><td class="yes">Sí</td><td>Solo consultar clientes</td><td class="no">No</td></tr>
<tr><td>Configuración</td><td class="yes">Completa</td><td>Solo Tokens de API*</td><td class="no">No</td></tr>
<tr><td>Bitácora de auditoría</td><td class="yes">Sí</td><td class="no">No*</td><td class="no">No</td></tr>
<tr><td>Privacidad (ARCO) y Ver como cliente</td><td class="yes">Sí</td><td class="no">No*</td><td class="no">No</td></tr>
</tbody></table></div>
<p>* Se puede conceder a un agente con un <b>rol personalizado</b> (Configuración → Roles).</p>
{callout('warn', 'Seguridad', '<p>La verificación en dos pasos es obligatoria para administradores. Las acciones delicadas (ajustes generales, privacidad, ver como cliente, tokens) pueden pedirte confirmar tu contraseña.</p>')}"""),
    ('organizaciones', 'Organizaciones y usuarios',
     'Cada cliente pertenece a una organización; los correos de sus dominios se asocian a ella.',
     f"""
{fig('admin-orgs', '<b>Organizaciones.</b> Invitaciones, alta de organizaciones con sus dominios, clave de Inncentives y casilla de IA.')}
<h3>Crear una organización</h3>
<ol class="steps">
<li>Abre <span class="path">Organizaciones</span>.</li>
<li>Escribe el <span class="ui">Nombre</span> y los <span class="ui">Dominios (separados por coma)</span>, por ejemplo <code>acme.com.mx, acme.mx</code>.</li>
<li>Pulsa <span class="btn">Crear</span>.</li>
<li>Si el cliente usa Inncentives, captura su <b>clave de Inncentives</b> en la columna Integraciones y pulsa <span class="ui">Guardar</span>. Marca <span class="ui">IA</span> solo si la organización autorizó el asistente de IA.</li>
</ol>
<h3>Invitar usuarios</h3>
<p>En <b>Invitar usuario</b> elige el <span class="ui">Rol</span> (Cliente, Agente o Administrador) y la organización. El personal de Neitek debe pertenecer a la organización interna.</p>
<h3>Importación masiva por CSV</h3>
<ul>
<li><b>Organizaciones</b>: columnas nombre, dominios (separados por <code>|</code>), plan y mfa.</li>
<li><b>Usuarios</b>: correo, nombre, organizacion y rol. Cada uno recibe su invitación.</li>
</ul>
<p>Primero pulsa <span class="ui">Validar (sin guardar)</span>; el botón <span class="btn">Importar</span> se habilita solo cuando no hay errores. Si hay errores, no se guarda nada.</p>"""),
    ('usuarios', 'Usuarios',
     'Consulta y edita a cualquier persona: datos, rol, organización, permisos, estado y seguridad.',
     f"""
{fig('admin-users', '<b>Usuarios.</b> Lista con filtros a la izquierda; a la derecha la ficha del usuario elegido, aquí con la confirmación para restablecer su verificación en dos pasos.')}
<h3>Buscar</h3>
<p>Abre <span class="path">Usuarios</span> en el menú Administrar. Busca por nombre o correo y filtra por rol, estado u organización. Pulsa el nombre de una persona para abrir su ficha. Los agentes también ven esta página, pero solo con los clientes y sin poder editarlos.</p>
<h3>Editar la ficha</h3>
<ol class="steps">
<li>En <b>Datos</b> corrige el nombre, el teléfono o el celular.</li>
<li>En <b>Rol y organización</b> cambia el <span class="ui">Rol</span> (Administrador, Agente o Cliente) y la <span class="ui">Organización</span>. La lista solo ofrece organizaciones válidas para el rol: el personal pertenece a la organización interna y los clientes a una organización cliente.</li>
<li>Para un cliente, marca si <span class="ui">Puede ver los tickets de toda su organización</span> y sus <span class="ui">Organizaciones adicionales</span>.</li>
<li>Para un agente o administrador, asigna <span class="ui">Roles personalizados</span> y su <span class="ui">Acceso a grupos</span> (niveles en el capítulo siguiente).</li>
<li>Pulsa <span class="btn">Guardar cambios</span> y confirma tu contraseña si se te pide.</li>
</ol>
{callout('warn', 'Al cambiar el rol', '<p>La persona debe iniciar sesión de nuevo. Si pasa a Cliente pierde sus accesos a grupos, roles personalizados y tokens de API. No puedes cambiar tu propio rol, estado u organización, y la mesa nunca se queda sin un administrador activo.</p>')}
<h3>Desactivar o reactivar</h3>
<p>En <b>Cuenta</b>, <span class="ui">Desactivar cuenta</span> impide que la persona entre y cierra sus sesiones; sus tickets e historial se conservan. <span class="ui">Reactivar cuenta</span> la habilita de nuevo.</p>
<h3>Seguridad</h3>
<ul>
<li><span class="ui">Cerrar sus sesiones</span>: la saca de todos los dispositivos.</li>
<li><span class="ui">Restablecer verificación en dos pasos</span>: para quien perdió su teléfono o su llave. Borra su app de autenticación, sus llaves o passkeys y sus códigos de recuperación, y cierra sus sesiones. Si es agente o administrador, deberá configurar un nuevo método al entrar. Pide confirmación y tu contraseña, y queda en la bitácora.</li>
</ul>
{callout('', 'Antes de restablecer', '<p>Confirma la identidad de la persona por otro medio (por ejemplo, una llamada a su número registrado). Quien restablece la verificación de otro le da acceso solo con su contraseña.</p>')}
<h3>Invitaciones pendientes</h3>
<p>Al final de la página están las invitaciones que nadie ha aceptado. <span class="ui">Reenviar</span> manda un enlace nuevo (el anterior deja de servir) y <span class="ui">Revocar</span> la cancela. Las vencidas se marcan como <b>Vencida</b>.</p>"""),
    ('accesos', 'Agentes y accesos a grupos',
     'Define qué grupos ve cada agente y qué puede hacer en ellos.',
     f"""
<p>El acceso a grupos se edita en la ficha del usuario (<span class="path">Usuarios</span>) o en <span class="path">Configuración</span> → <b>Agentes y accesos</b>; ambos guardan lo mismo.</p>
{fig('admin-access', '<b>Agentes y accesos.</b> Un grupo por fila con sus niveles de acceso.')}
<ol class="steps">
<li>Abre <span class="path">Configuración</span> → <b>Agentes y accesos</b> y elige al agente.</li>
<li>Pulsa <span class="ui">Agregar grupo</span>, elige el <span class="ui">Grupo</span> y marca los niveles.</li>
<li>Pulsa <span class="btn">Guardar</span>.</li>
</ol>
<div class="tbl"><table><thead><tr><th>Nivel</th><th>Permite</th></tr></thead><tbody>
<tr><td>Leer</td><td>Abrir y consultar los tickets del grupo.</td></tr>
<tr><td>Crear</td><td>Crear tickets en el grupo.</td></tr>
<tr><td>Modificar</td><td>Responder y cambiar datos de los tickets.</td></tr>
<tr><td>Ver en vistas</td><td>Que los tickets del grupo aparezcan en sus vistas.</td></tr>
<tr><td>Completo</td><td>Todo lo anterior.</td></tr>
</tbody></table></div>"""),
    ('configuracion', 'Configuración de la mesa',
     'Cada pestaña administra un catálogo con los botones Nuevo, Editar y Eliminar.',
     f"""
{fig('admin-config', '<b>Configuración.</b> Pestañas de catálogos a la izquierda; lista y formulario a la derecha.')}
<h3>Cómo se usa cada pestaña</h3>
<ol class="steps">
<li>Elige la pestaña. Verás la lista de registros; los inactivos se marcan con ✕.</li>
<li>Pulsa <span class="btn">Nuevo</span> o <span class="ui">Editar</span>. Se abre un formulario con los campos del registro.</li>
<li>Pulsa <span class="btn">Guardar</span>. Si algo puede causar un efecto no deseado (por ejemplo, una regla que se dispara a sí misma), verás «Advertencias: …».</li>
</ol>
<h3>Orden recomendado para la puesta en marcha</h3>
<ol class="steps">
<li><b>Calendarios</b> → <b>Grupos</b> → <b>Prioridades</b>.</li>
<li><b>Campos personalizados</b> y <b>Core Workflows</b> (qué se pide al crear un ticket).</li>
<li><b>SLAs</b> y <b>Planes de soporte</b>.</li>
<li><b>Vistas</b>, <b>Triggers</b> y <b>Planificadores</b>.</li>
<li><b>Macros</b>, <b>Módulos de texto</b>, <b>Plantillas</b> y <b>Firmas</b>.</li>
<li>Canales: <b>Canales de correo</b>, <b>Filtros postmaster</b>, <b>WhatsApp y SMS</b>, <b>Canales de Teams</b> y <b>Webhooks</b>.</li>
<li><b>Tipos de actividad</b> y <b>Retención</b>.</li>
</ol>
<h3>Pestañas</h3>
{CONFIG_TABLE}"""),
    ('reglas', 'Reglas: condiciones y acciones',
     'Triggers, planificadores, SLAs, vistas y Core Workflows comparten el mismo editor de condiciones.',
     f"""
{fig('admin-trigger', '<b>Nuevo trigger.</b> Nombre, evento, condiciones y acciones.')}
<h3>Condiciones</h3>
<ul>
<li>Elige <b>Se cumplen todas</b> o <b>Se cumple alguna</b>.</li>
<li><span class="ui">Agregar condición</span> crea una fila con <b>Campo</b>, <b>Operador</b> y <b>Valor</b>. El valor se adapta al campo: lista de estados, grupos o agentes por nombre, etiquetas, fecha o minutos relativos («-60» = hace una hora).</li>
<li><span class="ui">Agregar grupo</span> anida condiciones (por ejemplo, «canal es correo» Y («prioridad es Alta» O «organización es ACME»)).</li>
<li>Sin condiciones, la regla aplica a todos los tickets.</li>
</ul>
<p>Cada tipo de regla solo ofrece los campos y operadores que puede usar. Por ejemplo, «cambió» y «cambió a» solo existen en triggers.</p>
<h3>Acciones</h3>
<div class="tbl"><table><thead><tr><th>Acción</th><th>Uso típico</th></tr></thead><tbody>
<tr><td>Cambiar un campo</td><td>Estado, prioridad, grupo, propietario o «pendiente por (minutos)».</td></tr>
<tr><td>Cambiar un campo personalizado</td><td>Por ejemplo, fijar el módulo.</td></tr>
<tr><td>Agregar / Quitar etiquetas</td><td>Clasificar automáticamente.</td></tr>
<tr><td>Enviar notificación</td><td>Al propietario, al grupo, a los suscriptores, al cliente o a agentes específicos.</td></tr>
<tr><td>Agregar nota interna</td><td>Dejar contexto en el ticket.</td></tr>
<tr><td>Llamar un webhook</td><td>Avisar a otro sistema.</td></tr>
<tr><td>Responder al cliente</td><td>Acuse de recibo o recordatorio.</td></tr>
</tbody></table></div>
<p>En notificaciones y respuestas puedes usar variables como <code>{{{{ticket.number}}}}</code>, <code>{{{{customer.name}}}}</code> u <code>{{{{agent.name}}}}</code>.</p>
{callout('', 'Ejemplo', '<p>Trigger «Etiquetar correos entrantes»: se ejecuta al <b>Crear un ticket</b>, con la condición <b>Canal es Correo</b> y la acción <b>Agregar etiquetas: correo</b>.</p>')}"""),
    ('ajustes', 'Ajustes generales',
     'Parámetros globales de la mesa de soporte.',
     f"""
{fig('admin-settings', '<b>Ajustes generales</b>, agrupados por sección.')}
<div class="tbl"><table><thead><tr><th>Sección</th><th>Ajustes</th></tr></thead><tbody>
<tr><td>General</td><td>Nombre del producto, color principal, idioma predeterminado y prefijo del ticket en el asunto.</td></tr>
<tr><td>Tickets</td><td>Grupo para tickets del portal, máximo de respuestas automáticas por hora, si el cliente puede cerrar sus tickets y el registro de tiempo (y si es obligatorio).</td></tr>
<tr><td>Aviso de privacidad</td><td>Texto en español e inglés que se muestra al crear un ticket en el portal.</td></tr>
<tr><td>Chat en vivo</td><td>Activado, grupo que atiende y minutos de inactividad para cerrar (2 a 240).</td></tr>
<tr><td>WhatsApp y SMS</td><td>Versión de la API de WhatsApp, Account SID de Twilio y días para continuar en el mismo ticket.</td></tr>
<tr><td>Azure DevOps</td><td>Organización, proyecto, tipo de work item y nombre del secreto.</td></tr>
<tr><td>Inncentives</td><td>Modo (Desactivado, Demostración o Conectado), URL base y datos del widget.</td></tr>
<tr><td>Inteligencia artificial</td><td>Activado y modelo. Además, cada organización debe tener su casilla IA marcada.</td></tr>
<tr><td>Inicio de sesión único (SSO)</td><td>Hasta 5 proveedores (por ejemplo, Microsoft Entra ID): identificador, área, issuer, client ID, secreto, scopes y si se confía en su MFA.</td></tr>
</tbody></table></div>
{callout('warn', 'Secretos', '<p>Los campos «Nombre del secreto» guardan el <b>nombre</b> de un secreto en el resguardo de OCI Vault, nunca la contraseña o el token. Los valores reales los carga el equipo de infraestructura.</p>')}"""),
    ('kb', 'Base de conocimiento: edición',
     'Crea artículos en borrador, tradúcelos y publícalos.',
     f"""
<ol class="steps">
<li>En <span class="path">Base de conocimiento</span> pulsa <span class="btn">Nueva respuesta</span>.</li>
<li>Elige la <span class="ui">Categoría</span>, escribe el <span class="ui">Título</span> y el <span class="ui">Mensaje</span>. Marca <span class="ui">Solo para agentes (interna)</span> si no debe verla el cliente.</li>
<li>Pulsa <span class="btn">Guardar como borrador</span>. Se crea en el idioma que tengas seleccionado.</li>
<li>Abre el artículo. Con <span class="ui">Agregar traducción</span> escribe la versión en el otro idioma.</li>
<li>Pulsa <span class="btn">Publicar</span>. Si quieres programarlo, usa <span class="ui">Publicar a partir de</span>.</li>
</ol>
<p>También puedes <span class="ui">Archivar</span> un artículo, cambiarlo con <span class="ui">Hacer interna</span> / <span class="ui">Hacer visible a clientes</span> y consultar las <b>Versiones anteriores</b>.</p>"""),
    ('cumplimiento', 'Seguridad y cumplimiento',
     'Herramientas para auditoría, derechos ARCO y soporte asistido.',
     f"""
<h3>Bitácora de auditoría</h3>
{fig('admin-audit', '<b>Bitácora de auditoría</b> con la verificación de integridad.')}
<p>Muestra los últimos registros con fecha, acción, usuario e IP (inicios de sesión, cambios de configuración, accesos a datos). Pulsa <span class="ui">Verificar integridad</span> para comprobar que ningún registro fue alterado; el resultado es «Integridad verificada: N registros sin alteraciones».</p>
<h3>Privacidad (ARCO)</h3>
<ol class="steps">
<li>En <span class="path">Configuración</span> → <b>Privacidad (ARCO)</b> captura el <span class="ui">ID de usuario</span>, la <span class="ui">Acción</span> (export = exportar sus datos, anonymize = anonimizar, delete = eliminar) y el <span class="ui">Motivo</span>.</li>
<li>Pulsa <span class="btn">Iniciar</span> y confirma tu contraseña.</li>
<li>Cuando una exportación termine, usa <span class="ui">Descargar</span> para entregarla al titular.</li>
</ol>
<h3>Ver como cliente</h3>
<p>Para revisar exactamente lo que ve un cliente, en <b>Ver como cliente</b> captura su ID de usuario y un motivo y pulsa <span class="btn">Iniciar</span>. La sesión es de solo lectura, vence sola y queda registrada en la bitácora.</p>
<h3>Tokens de API</h3>
<p>Crea tokens para integraciones con nombre, permisos y vigencia. El token se muestra una sola vez; revócalo con <span class="ui">Eliminar</span> cuando ya no se use.</p>
<h3>Lo que hoy no se hace desde pantalla</h3>
<p>Crear o renombrar categorías de la base de conocimiento. Para eso, solicita apoyo al equipo técnico de Neitek.</p>"""),
]

ARTIFACT = '--artifact' in sys.argv
LINKS = ({'cliente': 'https://claude.ai/artifact/BevZ2UxkgUG68SeFSuFhAE',
          'agente': 'https://claude.ai/artifact/NA3cLK46mano5AgK7Uazmb',
          'administrador': 'https://claude.ai/artifact/926mCzS7vUxsT3EEve3jRZ'}
         if ARTIFACT else {s: f'manual-{s}.html' for s, _t, _a in MANUALS})


def standalone(html):
    head, body = html.split('<div class="shell">', 1)
    return ('<!doctype html>\n<html lang="es-MX">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            f'{head}</head>\n<body>\n<div class="shell">{body}</body>\n</html>\n')
def main():
    for slug, chapters, intro, audience in [
        ('cliente', cliente, 'Cómo pedir ayuda al equipo de Soporte Inncentives: crear tickets, dar seguimiento, usar el chat y la base de conocimiento, y cuidar tu cuenta.', 'usuarios de las empresas cliente'),
        ('agente', agente, 'Cómo atender tickets en la mesa de soporte: vistas, búsqueda, respuestas, notas internas, chat, teléfono, reportes y registro de tiempo.', 'agentes de soporte de Neitek'),
        ('administrador', administrador, 'Cómo administrar la mesa de soporte: organizaciones, usuarios y accesos, catálogos y reglas, ajustes generales, base de conocimiento y cumplimiento.', 'administradores de la mesa de soporte'),
    ]:
        title, area = next((t, a) for s, t, a in MANUALS if s == slug)
        html = page(slug, title, area, intro, audience, chapters, LINKS)
        (OUT / f'manual-{slug}.html').write_text(html if ARTIFACT else standalone(html), encoding='utf-8')
    print('ok')


if __name__ == '__main__':
    main()
