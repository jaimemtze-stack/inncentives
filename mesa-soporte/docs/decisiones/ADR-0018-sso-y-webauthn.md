# ADR-0018: SSO OIDC y WebAuthn

- **Estado:** aceptada (fase 2)
- **Decisión:**
  - **OIDC** (Authorization Code + PKCE S256, `state` y `nonce` de un solo uso en Redis, 10 min) con proveedores configurables por área: Entra ID para agentes; el Identity Server de Inncentives para clientes, opcional. El `id_token` se verifica con `jose` (firma por JWKS del *discovery*, `iss`, `aud`, algoritmos asimétricos).
  - **Sin aprovisionamiento ni vinculación por correo.** Una identidad (`issuer` + `sub`) solo inicia sesión si un usuario **ya autenticado y con reautenticación reciente** la vinculó desde "Mi cuenta". Un correo coincidente nunca basta (evita tomas de cuenta por un IdP mal configurado).
  - El SSO sustituye la contraseña, no el segundo factor: se pide el MFA propio salvo que el proveedor esté marcado `trustIdpMfa` **y** el token traiga `amr` con `mfa`. Se audita `auth.sso.login`, vinculación y desvinculación.
  - **WebAuthn / passkeys** (`@simplewebauthn/server`) como segundo factor adicional o alternativo al TOTP. RP ID = host del área (las llaves del portal y de agentes no se mezclan); reto de 5 minutos en Redis atado a la sesión; contador anti-clonación; máximo 10 llaves. Registrar la primera llave genera códigos de recuperación. El personal no puede quitar su último factor.
- **Consecuencias:** el secreto del cliente OIDC vive como archivo (`sso_entra_client_secret`); si el IdP cae, la contraseña + MFA sigue funcionando.
