# Manuales de usuario

Manuales ilustrados de Soporte Inncentives, con el estilo visual de la aplicación (barra lateral azul marino, fondo crema y acentos amarillos) y capturas de las pantallas reales con datos de ejemplo.

| Manual | Para | Página | PDF |
|---|---|---|---|
| Cliente | Usuarios de las empresas cliente (portal) | [manual-cliente.html](manual-cliente.html) | [manual-cliente.pdf](manual-cliente.pdf) |
| Agente | Agentes de soporte de Neitek | [manual-agente.html](manual-agente.html) | [manual-agente.pdf](manual-agente.pdf) |
| Administrador | Administradores de la mesa de soporte | [manual-administrador.html](manual-administrador.html) | [manual-administrador.pdf](manual-administrador.pdf) |

## Manual técnico (uso interno)

[manual-tecnico.html](manual-tecnico.html) · [manual-tecnico.pdf](manual-tecnico.pdf): arquitectura, infraestructura en OCI, contenedores, despliegue, respaldos, seguridad, operación y estado de producción, con diagramas. Se genera con `python3 build_tecnico.py`.

Las páginas HTML se abren directamente en el navegador y se enlazan entre sí. Los PDF están en tamaño carta para enviar o imprimir.

[agente.md](agente.md) y [administrador.md](administrador.md) son las guías cortas originales; incluyen detalles de operación (Cloudflare Access, correos por verificar, secretos) que no están en los manuales ilustrados.

## Actualizar

1. Edita el contenido en `build.py` (cada manual es una lista de capítulos).
2. Si cambió una pantalla, reemplaza su captura en `img/` (JPEG de 1600 px de ancho).
3. Ejecuta `python3 build.py` (manuales de usuario) o `python3 build_tecnico.py` (manual técnico) para regenerar los HTML.
4. Regenera el PDF imprimiendo el HTML desde el navegador (*Imprimir → Guardar como PDF*, tamaño carta, con gráficos de fondo); la hoja de estilos de impresión oculta la barra lateral y empieza cada capítulo en página nueva.
