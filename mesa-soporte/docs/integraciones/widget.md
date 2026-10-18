# Widget "Reportar un problema" y chat para el Sistema administrativo de Inncentives

## 1. Incluir el script

```html
<script src="https://soporte.inncentives.com/widget.js" defer></script>
<script nonce="…">
  window.addEventListener('load', () =>
    MesaWidget.init({
      portal: 'https://soporte.inncentives.com',
      getContextToken: () => fetch('/api/support/context-token', { credentials: 'same-origin' }).then((r) => r.text()),
      chat: true,
    }),
  );
</script>
```

La CSP de Inncentives debe permitir `script-src https://soporte.inncentives.com`. El botón abre el portal
en una ventana nueva (el portal no se puede incrustar en un iframe). Si no hay token, abre "Nuevo ticket".

## 2. Firmar el contexto (backend de Inncentives)

JWT **HS256** firmado con el secreto compartido `inncentives_widget_secret` (≥ 32 caracteres; el mismo
valor en Inncentives y en el OCI Vault de la mesa). Nunca se expone al navegador.

| Claim | Valor |
|---|---|
| `iss` | `inncentives` (configurable: `inncentives.widgetIssuer`) |
| `aud` | `mesa-soporte` |
| `iat`, `exp` | vida ≤ 15 minutos |
| `jti` | identificador único (un ticket por token) |
| `tenant` | clave de tenant del cliente (`[a-z0-9-]{2,63}`) |
| `environment` | `{ "id", "name", "kind": "production" \| "test" \| "development" }` |
| `module` | opcional: `organizacion`, `beneficiarios`, `tablas`, `carga`, `calendarios`, `planes`, `procesos`, `flujos`, `reportes`, `portal`, `centro_comando`, `seguridad`, `api` (otro valor → "otro") |
| `url` | opcional, `https://…` de la pantalla |
| `version` | opcional |
| `email` | opcional: usuario de Inncentives que reporta |

Ejemplo (Node):

```js
import { SignJWT } from 'jose';
const token = await new SignJWT({ tenant, environment, module, url, version, email })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuer('inncentives').setAudience('mesa-soporte')
  .setIssuedAt().setExpirationTime('10m').setJti(crypto.randomUUID())
  .sign(new TextEncoder().encode(process.env.MESA_WIDGET_SECRET));
```

## 3. Qué valida la mesa

Firma, `aud`, `iss`, antigüedad ≤ 15 min, forma de cada claim y que `tenant` sea la clave de la
organización del cliente que **inició sesión en el portal**. Con otro cliente responde 403. El token
viaja en el fragmento `#ctx=` y no se registra en ningún servidor.
