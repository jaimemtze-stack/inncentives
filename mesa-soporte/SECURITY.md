# Política de seguridad — Mesa de soporte de Inncentives

## Reportar una vulnerabilidad

Escribe a **seguridad@neitek.com** (buzón provisional, a confirmar por Neitek) con:
- una descripción y el impacto;
- los pasos para reproducirla;
- las versiones o URLs afectadas.

No abras *issues* públicos ni pruebes contra datos de clientes.

- Acuse de recibo: ≤ 2 días hábiles.
- Evaluación inicial: ≤ 5 días hábiles.
- Corrección de severidad crítica o alta: objetivo ≤ 30 días, con aviso coordinado.

## Alcance

El código de `mesa-soporte/`, su infraestructura (`infra/`, `deploy/`) y las imágenes publicadas en `ghcr.io/<org>/mesa-*`.

## Prácticas

- Las prácticas están descritas en `docs/seguridad/`: modelo de amenazas, matriz ASVS nivel 2 y respuesta a incidentes.
- Cada cambio pasa por CI: lint, tipos, pruebas, gitleaks, Semgrep, `pnpm audit`, Trivy (IaC e imágenes) y pruebas de autorización.
- Solo se despliegan imágenes firmadas por el workflow de `main`, después de una aprobación manual.
