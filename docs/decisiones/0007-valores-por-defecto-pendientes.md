# ADR-0007: Valores por defecto de las decisiones pendientes

- **Estado:** aceptado · **Fecha:** 2026-10-15

Mientras el negocio decide, se implementan estos valores (sección 10 del prompt). Todos son configurables y se cargan en el *seed*.

| # | Tema | Valor por defecto | Dónde se configura |
|---|---|---|---|
| 1 | Volumen | 50 agentes, 300 organizaciones, 5,000 tickets/mes en una VM | `docs/despliegue.md` (escalamiento) |
| 2 | Niveles | Grupos "Soporte N1/N2/N3", "Por verificar"; escalamiento manual | Admin › Grupos |
| 3 | Plan y SLA | Plan "Estándar": crítica 1h/4h, alta 2h/8h, normal 4h/24h, baja 8h/40h (respuesta/solución, horas hábiles). El prompt no fija el tiempo de **actualización**; se usa el doble de la primera respuesta (2h, 4h, 8h, 16h) | Admin › SLAs / Planes |
| 4 | SSO | Local + MFA; OIDC en fase 2 | `AUTH_OIDC_*` |
| 5 | MFA clientes | Recomendado; por organización | Organización › `mfaPolicy` |
| 6 | Correo | `MAIL_ADAPTER`; Mailpit en local | Variables de entorno |
| 7 | Telefonía | Registro manual + webhook CTI genérico | Admin › Integraciones |
| 8 | Infraestructura | Azure Mexico Central + Cloudflare | ADR-0005 |
| 9 | Retención | Mecanismo presente, **deshabilitado** | Admin › Seguridad › Retención |
| 10 | IA | Deshabilitada; no se implementa antes de fase 3 | — |
| 11 | RPO/RTO | 24 h / 8 h | `docs/despliegue.md` |
| — | Número de ticket | `YYYYMMDDNNNN`, prefijo de asunto `Ticket#` | `TICKET_NUMBER_FORMAT`, `TICKET_SUBJECT_PREFIX` |
| — | Umbral "en riesgo" de SLA | 80 % | `Sla.warningPercent` |
| — | Tamaño máximo de adjunto | 25 MB | `ATTACHMENT_MAX_BYTES` |
