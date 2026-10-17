# ADR-0007: Infraestructura en OCI México con Always Free

- **Estado:** aceptada (decisión de Neitek, 17-oct-2026)
- **Decisión:**
  - **Región y cuenta:** Querétaro (`mx-queretaro-1`), cuenta de pago por uso con presupuesto.
  - **Cómputo:** una VM `VM.Standard.A1.Flex` de 2 OCPU / 12 GB con Ubuntu 24.04 aarch64, más un volumen de bloque de 100 GB para datos.
  - **Red:** subred privada sin IP pública, NAT Gateway y Service Gateway. Ninguna regla de entrada salvo SSH desde OCI Bastion. La lista de seguridad por defecto se reemplaza por una vacía.
  - **Cifrado:** Vault DEFAULT con llave maestra en HSM, que cifra volúmenes y buckets.
  - **Entrada web:** Cloudflare Tunnel (sin puertos abiertos), WAF y Access con Entra ID para el host de agentes y para SSH.
  - **Gobierno:** Cloud Guard, Security Zone (receta de máxima seguridad), escaneo de vulnerabilidades, alarmas por correo (canal de Teams) y presupuesto con alertas.
- **Consecuencias:**
  - Todas las imágenes son multi-arquitectura; ClamAV usa `clamav/clamav-debian`, porque la imagen Alpine solo existe para amd64.
  - **Sin respaldos de volumen de Oracle,** porque excederían los 5 gratuitos. La protección de datos es pgBackRest más volcados inmutables.
  - Terraform se valida en CI contra el proveedor `oracle/oci` 9.10, pero no se aplica desde CI.
