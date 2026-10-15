# ADR-0001: Stack tecnológico y monorepo

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
La mesa de soporte maneja datos personales y potencialmente de nómina, la opera un equipo pequeño y debe ser barata de operar y portable. El prompt de origen fija un stack de referencia.

## Decisión
- TypeScript `strict` en todo el proyecto, monorepo **pnpm workspaces**: `apps/api`, `apps/web`, `apps/worker`, `packages/shared`.
- API: **NestJS sobre Fastify**. Validación con **Zod** (esquemas en `packages/shared`, compartidos con el frontend).
- **PostgreSQL 16** con búsqueda de texto completo nativa (`tsvector`, diccionarios `spanish`/`english`); sin Elasticsearch.
- **Prisma** para esquema, migraciones y consultas parametrizadas. SQL crudo solo con `$queryRaw` etiquetado (nunca `$queryRawUnsafe`), regla verificada por Semgrep.
- **Redis 7 + BullMQ** para colas; **Socket.IO** con adaptador Redis para tiempo real.
- Frontend: **React 18 + Vite + TanStack Router/Query + Tailwind + shadcn/ui + i18next**; editor **TipTap** con sanitización en servidor.
- Pruebas: Vitest, Supertest, Playwright, Testcontainers.
- Observabilidad: pino (JSON), OpenTelemetry, `/health` y `/ready`.
- La lógica de dominio pura (calendarios, SLA, detector de datos sensibles, plantillas) vive en `packages/shared`, sin dependencias de infraestructura, para probarla al 80 %+ y reutilizarla en cliente y servidor.

## Alternativas consideradas
- **Zammad autoalojado:** cumple la funcionalidad pero exige Ruby/Rails + Elasticsearch, es costoso de adaptar al modelo de autorización y a los requisitos de datos de nómina.
- **Express en lugar de Fastify:** más común, pero Fastify da mejor rendimiento y validación de límites de cuerpo integrada.
- **Drizzle en lugar de Prisma:** más ligero, pero Prisma tiene migraciones más maduras y el prompt lo fija.

## Consecuencias
- Un solo lenguaje y contratos compartidos reducen errores de integración.
- Prisma no modela `tsvector` ni triggers: se agregan en migraciones SQL manuales (documentado en `apps/api/prisma/README.md`).
- NestJS añade peso de arranque, aceptable en una sola VM.
