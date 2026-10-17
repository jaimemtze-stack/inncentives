# ADR-0004: Almacenamiento de archivos

- **Estado:** aceptada
- **Decisión:**
  - **Interfaz:** `StorageProvider` con dos adaptadores.
    - `S3Storage`: SeaweedFS en desarrollo y CI. MinIO dejó de publicar imágenes de la edición comunitaria, por eso se cambió a SeaweedFS.
    - `OciStorage`: producción, con el SDK nativo de OCI y *instance principals*, sin llaves. El cliente se crea en el primer uso, así que un servicio de metadatos lento no impide arrancar la API; la prueba de humo del stack de producción detectó ese caso.
  - **Llaves de objeto:** las genera la aplicación y se validan con un patrón (sin `..`, sin `/` inicial). El nombre original del archivo solo viaja en `Content-Disposition`.
  - **Descargas:** URL firmada de máximo 300 s (S3 presign / OCI PAR de solo lectura y por objeto), generada después de verificar permisos.
- **Consecuencias:** las pruebas cubren ambos adaptadores (SeaweedFS real y cliente OCI simulado).
