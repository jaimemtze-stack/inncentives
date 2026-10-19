# Contrato propuesto: API de Inncentives para la mesa de soporte

La mesa de soporte solo **lee**. Este es el contrato que implementa `HttpInncentivesClient`
(`apps/api/src/integrations/inncentives/inncentives.http.ts`). Si la API real difiere, se ajusta ese
archivo; el resto de la aplicación usa la interfaz `InncentivesClient`.

## Autenticación y reglas generales

- HTTPS obligatorio; sin redirecciones.
- `Authorization: Bearer <token>`: token de solo lectura, guardado como secreto `inncentives_api_token`.
- Respuestas JSON `{ "items": [...] }`, máximo 100 elementos y 1 MB; tiempo de respuesta < 5 s.
- `404` se interpreta como "sin datos". Cualquier otro error deja la barra lateral en "no disponible".

## Endpoints

### `GET /v1/tenants/{tenantKey}/environments`

`tenantKey`: `[a-z0-9-]{2,63}` (se captura en *Administración → Organizaciones*).

```json
{ "items": [
  { "id": "acme-prod", "name": "Producción", "kind": "production",
    "version": "2026.9.2", "url": "https://acme.inncentives.com" }
] }
```

`kind`: `production` | `test` | `development`.

### `GET /v1/environments/{environmentId}/process-runs?status=failed&limit=5`

```json
{ "items": [
  { "id": "r1", "environmentId": "acme-prod", "process": "Cálculo de comisiones", "module": "calculo",
    "status": "failed", "startedAt": "2026-10-01T15:00:00Z", "finishedAt": "2026-10-01T15:04:00Z",
    "message": "Regla sin periodo vigente." }
] }
```

### `GET /v1/environments/{environmentId}/log-events?limit=5`

```json
{ "items": [
  { "id": "e1", "environmentId": "acme-prod", "at": "2026-10-01T15:00:00Z",
    "module": "liquidacion", "action": "Liquidación publicada", "user": "admin@cliente.com" }
] }
```

## Activación

*Configuración → Ajustes generales → `inncentives`*: `mode: "http"`, `baseUrl: "https://…"`. Mientras la
API no exista, el modo queda en `off`; `mock` sirve datos de demostración (solo desarrollo).
