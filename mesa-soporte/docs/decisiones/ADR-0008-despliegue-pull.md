# ADR-0008: Despliegue "pull" con firmas verificadas

- **Estado:** aceptada
- **Decisión:**
  - **Construcción y firma:** GitHub Actions construye imágenes amd64+arm64 con SBOM y procedencia, y las firma con cosign *keyless* (OIDC de GitHub).
  - **Aprobación:** solo tras la aprobación manual del entorno `production` se publica un release `mesa-v*` con `manifest.json` (imágenes por *digest*).
  - **En la VM,** `deployer.sh` (timer cada 10 min) hace lo siguiente:
    1. toma el último release `mesa-v*` publicado;
    2. exige *digests*;
    3. verifica cada firma contra la identidad exacta del workflow en `main`;
    4. hace un respaldo incremental;
    5. ejecuta las migraciones con el rol `app_migrator`;
    6. despliega;
    7. espera el *healthcheck*;
    8. si falla, **revierte** a las imágenes anteriores.
  - **GitHub no guarda ninguna credencial de OCI.** La VM usa un token de solo lectura (contenidos y paquetes), solo durante el *pull*.
- **Consecuencias:**
  - Las migraciones deben ser compatibles hacia atrás (expand/contract), porque la reversión no deshace el esquema.
  - Firmar con cosign v2.6.1 en CI coincide con la versión que verifica en la VM.
