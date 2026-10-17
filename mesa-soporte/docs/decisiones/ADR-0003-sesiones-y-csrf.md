# ADR-0003: Sesiones en servidor, cookies por host y CSRF en dos capas

- **Estado:** aceptada
- **Decisión:**
  - **Cookie:** token aleatorio de 256 bits en `__Host-sid` (`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sin `Domain`). Así cada host (portal / agentes) tiene su propia cookie.
  - **Almacén:** Redis guarda solo el SHA-256 del token; un volcado de Redis no se puede reutilizar como cookie.
  - **Expiración:** por inactividad (30 min) y absoluta (12 h). El identificador rota al completar MFA y al cambiar la contraseña.
  - **CSRF, capa 1:** en toda petición que cambia estado, `Origin` (o `Referer`) debe coincidir exactamente con `https://<host>`, y `Sec-Fetch-Site`, si viene, debe ser `same-origin`.
  - **CSRF, capa 2:** token por sesión en `X-CSRF-Token` (sincronizador) para usuarios autenticados.
  - **Sin JWT en el navegador.** La web nunca lee la cookie.
- **Consecuencias:** el *logout*, la revocación y el cierre de otras sesiones son inmediatos. Hay estado en Redis, que se respalda con AOF.
