# ADR-0005: Despliegue en Azure Mexico Central detrás de Cloudflare

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
Criterios: seguridad, bajo costo, residencia de datos en México y portabilidad. Volumen de diseño: 50 agentes, 300 organizaciones, 5,000 tickets/mes.

## Decisión
- **Una VM Linux** (2 vCPU, 8 GB) en Azure **Mexico Central** con Docker Compose: `api`, `web`, `worker`, `redis`, `clamav`, `cloudflared`.
- **Azure Database for PostgreSQL Flexible Server** con acceso privado (VNet). Si no está disponible en la región, PostgreSQL 16 en contenedor con disco cifrado y respaldos `pg_dump` cifrados a Blob.
- **Blob Storage** privado para adjuntos y respaldos; **Key Vault** con Managed Identity para secretos.
- **Cloudflare Tunnel**: sin puertos entrantes en la VM. WAF, DDoS y TLS en Cloudflare. **Cloudflare Access** (Entra ID) protege el host de agentes/admin.
- Hosts separados: `soporte.<dominio>` (portal) y `agentes.soporte.<dominio>` (agentes y admin). Webhooks entrantes bajo `/hooks/*` (excluidos de Access, autenticados por HMAC).
- 12-factor: configuración por variables de entorno; secretos por archivo montado, Docker secrets o Key Vault.

## Alternativas
- **Azure Container Apps:** más elástico y caro para este volumen; la imagen es compatible si se migra.
- **AKS:** excesivo para el volumen y el equipo.

## Consecuencias
- Punto único de falla en la VM: se mitiga con respaldos fuera del servidor, RTO 8 h y reconstrucción por script.
- Detalle operativo en `docs/despliegue.md`.
