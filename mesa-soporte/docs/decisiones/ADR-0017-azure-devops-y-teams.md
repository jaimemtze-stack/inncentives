# ADR-0017: Azure DevOps, Microsoft Teams y webhooks salientes

- **Estado:** aceptada (fase 2)
- **Decisión:**
  - **Azure DevOps:** desde un ticket se crea un *work item* (tipo por defecto en ajustes, título `[#número] título`) o se vincula uno existente. Autenticación con un PAT de alcance **Work Items (lectura y escritura)** guardado como secreto `azure_devops_pat` (nunca en la BD). `jobs` sincroniza el estado cada 15 minutos y agrega una **nota interna** cuando cambia. El *service hook* `POST /hooks/azure-devops` exige *Basic auth* con `azure_devops_hook_secret` (comparación en tiempo constante) y **no confía en el cuerpo**: solo toma el id y vuelve a leer el estado por la API. El cliente HTTP rechaza redirecciones.
  - **Teams:** notificaciones por canal mediante *Workflows* (webhook entrante). La URL se valida contra una lista de hosts de Microsoft (`*.webhook.office.com`, `*.logic.azure.com`, `*.environment.api.powerplatform.com`), se guarda **cifrada** (AES-GCM, AAD = id del canal) y nunca se devuelve en la API. La tarjeta lleva **solo metadatos** (número, título, organización, prioridad, evento y enlace), nunca el contenido de los mensajes del cliente.
  - **Webhooks salientes** (fase 1) y Teams comparten el llamador con protección SSRF y ahora registran cada intento en `webhook_deliveries` (estado HTTP, error, duración), visible en Configuración → Webhooks / Canales de Teams → Entregas.
- **Consecuencias:** sin bot de Teams (no hace falta registro en Azure Bot Service); la sincronización puede tardar hasta 15 minutos si el *service hook* no está configurado.
