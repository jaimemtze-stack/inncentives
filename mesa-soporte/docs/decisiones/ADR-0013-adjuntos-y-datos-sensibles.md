# ADR-0013: Adjuntos, antivirus y datos sensibles

- **Estado:** aceptada (fase 1)
- **Decisión:**
  - **Subida en dos pasos:** el archivo se sube a un área de preparación ligada al usuario y luego se asocia a un artículo. Los no usados se borran a las 24 h.
  - **Validación:** lista blanca de extensiones **y** tipo real por *magic bytes* (PDF, imágenes, texto/CSV, OOXML/ODF verificados por contenido del ZIP, OLE). SVG y HTML no se aceptan. Nombres saneados; la llave de almacenamiento es aleatoria.
  - **Antivirus:** ClamAV (`INSTREAM` sobre TCP) desde el proceso `jobs`. Hasta que el escaneo termina, el archivo no se puede descargar. Infectado → cuarentena (no se entrega), nota interna y notificación al propietario y a los administradores. Sin `CLAMAV_HOST`, en producción nada es descargable (falla cerrado).
  - **Descarga:** URL firmada de 60 s desde el dominio del almacenamiento (sin cookies), después de comprobar el acceso al ticket; los clientes nunca ven adjuntos de notas internas. Las vistas previas de imágenes se recodifican a PNG en el servidor (sin EXIF). Cada descarga queda en la bitácora.
  - **Datos sensibles:** detector propio de RFC (persona física), CURP (dígito verificador), NSS (Luhn), CLABE (dígito verificador), tarjetas (Luhn) y encabezados de sueldo/salario en CSV/XLSX/DOCX. Lector de ZIP propio con límite de inflado (anti *zip bomb*). Al cliente se le avisa antes de enviar; el ticket muestra la bandera y el agente puede redactar el artículo o eliminar el adjunto (auditado).
  - **Retención y ARCO:** políticas desactivadas por defecto (eliminar adjuntos de tickets cerrados, anonimizar tickets); tareas de privacidad (exportar en ZIP, anonimizar, eliminar cliente) solicitadas con motivo y reautenticación, procesadas por `jobs` y auditadas.
