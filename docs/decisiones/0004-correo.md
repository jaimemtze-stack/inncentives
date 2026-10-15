# ADR-0004: Correo — adaptadores Microsoft Graph e IMAP/SMTP

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
El buzón de soporte en Microsoft 365 todavía no existe. El desarrollo y las pruebas no deben depender de él.

## Decisión
- Interfaces `InboundMailAdapter` y `OutboundMailAdapter` en `apps/worker`.
- Adaptadores: **Graph** (polling configurable o suscripción a cambios; autenticación con Managed Identity o secreto de aplicación en Key Vault, permiso `Mail.ReadWrite`/`Mail.Send` limitado al buzón por *Application Access Policy*) e **IMAP/SMTP** (alternativa; Mailpit en local).
- Selección por variable `MAIL_ADAPTER=graph|imap|smtp-mailpit`.
- El correo entrante se guarda crudo (RFC 822) en almacenamiento privado antes de procesarse, para poder reprocesar.
- Confianza en el remitente solo si `Authentication-Results` del proveedor indica `dmarc=pass` (o `spf=pass` y `dkim=pass` alineados). Si no, el ticket va al grupo **"Por verificar"** sin respuesta automática.
- Nunca se crean usuarios cliente desde un correo.
- Hilos: `In-Reply-To`/`References` contra `Message-ID` guardados, y número de ticket en el asunto con prefijo configurable. Nunca solo por asunto.

## Consecuencias
- La lógica de hilos, bucles y filtros postmaster se prueba de forma unitaria sin buzón real.
- Al crear el buzón solo cambian variables de entorno y secretos.
