# ADR-0009: Controles de cadena de suministro de dependencias

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
La primera ejecución del CI (PR #1) encontró 37 vulnerabilidades conocidas en dependencias de producción (Fastify 4, NestJS 10, nodemailer 6) y hallazgos de Semgrep sobre la cadena de suministro: acciones de GitHub con etiquetas mutables (la etiqueta `0.28.0` de `trivy-action` ya no existe tras el incidente de esa acción), sin espera para versiones recién publicadas y sin política de confianza en pnpm.

## Decisión
- **Versiones:** NestJS 11.2.7, Fastify 5.12.5, pino 10, nodemailer 10.0.16 (`pnpm audit --prod` sin hallazgos).
- **pnpm** (`pnpm-workspace.yaml`):
  - `minimumReleaseAge: 10080`: no se instala ninguna versión con menos de 7 días publicada.
  - `blockExoticSubdeps: true`: sin sub-dependencias desde git o tarballs.
  - `trustPolicy: no-downgrade` con `trustPolicyIgnoreAfter` de 1 año: bloquea versiones recientes publicadas con menos garantías (firma/procedencia) que las anteriores. Las versiones de más de un año se exentan porque el ecosistema anterior a la procedencia (p. ej. `semver@6.3.1`) nunca tendrá firma.
  - `trustPolicyExclude: vite@5.4.21`: verificada a mano. La publicó el bot oficial `vitebot` con procedencia SLSA, y solo se marca porque una rama más nueva ya usaba *trusted publishing*. Se usa solo en compilación.
- **GitHub Actions:** toda acción fijada por SHA de commit completo, con la versión como comentario.
- **Dependabot:** `cooldown` de 7 días, coherente con pnpm.
- **ESLint:** el código de ejecución (`apps/api/src`, `apps/worker/src`) no puede importar paquetes de prueba. Un import de `@nestjs/testing` habría roto la imagen de producción; se detectó simulando el build de Docker.

## Consecuencias
- Un parche de seguridad urgente con menos de 7 días requiere una excepción explícita y revisada (`minimumReleaseAgeExclude`), documentada aquí.
- Las actualizaciones de acciones llegan por Dependabot como cambios de SHA.
