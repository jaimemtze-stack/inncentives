# Manual corto del agente

## Entrar

`https://agentes.soporte.inncentives.com` → Cloudflare Access (cuenta de Neitek) → correo y contraseña → código de la app de autenticación.

## Bandeja

- A la izquierda están las **vistas** con su contador (*Mis tickets*, *Sin asignar*, *Escalados*, *Por verificar*…). Arriba, la **búsqueda**: texto libre, `#202610170001`, `state:open`, `tag:carga`.
- Etiquetas rojas = **SLA vencido**; ámbar = **en riesgo** (80 % del tiempo). ⚠ = el ticket puede contener datos personales.

## Atender un ticket

- Al abrir un ticket sin propietario de un grupo con asignación automática, queda asignado a ti.
- Si otro agente lo está viendo o escribiendo, aparece un aviso arriba.
- **Responder:** elige *Correo* (sale desde la dirección del grupo con su firma), *Nota* (interna por defecto; desmarca la casilla para que el cliente la vea) o *Llamada*. Escribe `::palabra` para insertar un módulo de texto. Registra el tiempo en minutos si se pide.
- **Panel derecho:** estado (los estados *pendiente* piden fecha), prioridad, grupo, propietario, campos del caso, etiquetas, lista de verificación, seguir/dejar de seguir, macros y fusionar.
- **Datos sensibles:** si un artículo muestra ⚠, usa *Redactar datos personales* o elimina el adjunto. Queda registrado.
- **Imágenes remotas** de correos: están bloqueadas; pulsa *Mostrar imágenes remotas* solo si confías en el remitente.

## Correos "Por verificar"

Llegan de remitentes desconocidos o que no pasaron SPF/DKIM/DMARC. No respondas con información del cliente: confirma la identidad por otro medio, **asocia el cliente correcto** desde el aviso del ticket y muévelo al grupo adecuado.

## Teléfono

*Teléfono* → escribe el número: verás al cliente y sus tickets abiertos. Desde ahí registra la llamada como ticket nuevo, o agrégala como artículo *Llamada* en un ticket existente. Cuando haya proveedor de telefonía, las llamadas entrantes aparecerán como aviso en la esquina.

## Notificaciones y ausencias

La campana muestra asignaciones, respuestas de clientes, menciones y alertas de SLA. Configura qué llega por correo y tu ausencia (con sustituto) en *Mi cuenta → Notificaciones y ausencia*; mientras estés fuera, tu sustituto ve tus tickets en *Mis tickets*.
