# Manual corto del agente

## Entrar

`https://agentes.soporte.inncentives.com` → Cloudflare Access (cuenta de Neitek) → correo y contraseña → código de la app de autenticación **o** llave de seguridad / passkey.

- **Entrar con Microsoft** (fase 2): primero vincula tu cuenta en *Mi cuenta → Inicio de sesión único → Vincular con Microsoft* (te pedirá tu contraseña). Después usa el botón en la pantalla de entrada.
- **Passkeys / llaves de seguridad:** agrégalas en *Mi cuenta → Llaves de seguridad y passkeys*. Al entrar, elige *Usar una llave de seguridad o passkey* en lugar del código. Conserva siempre un segundo factor (la app o otra llave).

## Bandeja

- A la izquierda están las **vistas** con su contador (*Mis tickets*, *Sin asignar*, *Escalados*, *Por verificar*…). Arriba, la **búsqueda**: texto libre, `#202610170001`, `state:open`, `tag:calculo`, `owner:me`, `org:"ACME"`, `group:"Soporte N2"` (se pueden combinar). Además de tickets, muestra respuestas de la base de conocimiento, personas y organizaciones.
- La vista **Mis menciones** reúne los tickets donde alguien te mencionó con `@`.
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

## Base de conocimiento, Azure DevOps y reportes (fase 2)

- En el editor de respuesta, **Insertar de la base de conocimiento** busca una respuesta y agrega su texto o enlace. Las respuestas internas no deben enviarse al cliente.
- En el panel del ticket, **Azure DevOps** crea un *work item* (con el número y título del ticket) o vincula uno existente por su ID. Cuando cambie de estado verás una nota interna.
- *Reportes* muestra tus métricas y las de tus grupos; solo incluye tickets que puedes ver.

## WhatsApp, SMS y chat (fase 3)

- Los tickets de WhatsApp y SMS se responden desde el mismo editor eligiendo **WhatsApp** o **SMS** como tipo (solo texto). WhatsApp solo permite responder hasta **24 horas** después del último mensaje del cliente; pasado ese plazo usa correo o teléfono.
- El estado de cada mensaje (En cola, Enviado, Entregado, Leído, Falló) aparece junto al artículo.
- **Chat:** en *Chat* marca *Disponible para chat* (se mantiene mientras tengas la aplicación abierta). Pulsa *Atender* en un chat en espera; al terminar, el ticket se cierra solo.

## Inncentives e IA (fase 3)

- El panel **Inncentives** del ticket muestra los ambientes del cliente, su versión, los procesos con error y la Bitácora reciente.
- Los tickets del widget "Reportar un problema" traen ambiente, módulo y versión llenos, y una nota interna con la URL y la hora.
- Si tu organización autorizó la IA, el panel **Asistente de IA** resume, sugiere una respuesta (se inserta en el editor para que la revises) y clasifica (aplicas tú). En el editor, *Reescribir con IA* corrige, formaliza, acorta o traduce tu borrador. Revisa siempre el resultado: nada se envía solo.
