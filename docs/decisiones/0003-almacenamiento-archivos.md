# ADR-0003: Almacenamiento de adjuntos y escaneo

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
Los clientes pueden adjuntar Excel con datos de nómina, y cualquier adjunto puede contener malware.

## Decisión
- Interfaz `ObjectStorage` con adaptadores **S3** (MinIO local, Cloudflare R2) y **Azure Blob Storage** con Managed Identity (sin claves compartidas).
- Contenedores/buckets **privados**. Clave de almacenamiento aleatoria (`att/<uuid>`); el nombre original solo se guarda saneado como metadato.
- Flujo: subida → validación de extensión (lista blanca) y *magic bytes* → hash SHA-256 → estado `pending` → job de **ClamAV** (`clamd` por TCP, INSTREAM) → `clean` | `infected` (cuarentena, notificación) | `error` (reintento).
- Solo adjuntos `clean` se pueden descargar. La descarga pasa por la API (comprobación de permisos con `PolicyService` + auditoría) y redirige a una **URL firmada ≤ 5 min** con `Content-Disposition: attachment` y `nosniff`.
- Vistas previas de imágenes recodificadas sin EXIF (sharp) en el worker.
- Detector de datos sensibles (5.7) sobre texto, CSV y XLSX en el mismo job de escaneo.

## Consecuencias
- Los adjuntos no están disponibles hasta terminar el escaneo (segundos). La UI muestra "analizando".
- Si ClamAV no responde, el adjunto queda en `error` y no se entrega: falla cerrado.
