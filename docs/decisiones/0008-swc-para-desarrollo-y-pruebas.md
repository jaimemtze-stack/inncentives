# ADR-0008: SWC para ejecutar TypeScript en desarrollo y pruebas de la API

- **Estado:** aceptado · **Fecha:** 2026-10-15

## Contexto
NestJS resuelve la inyección de dependencias con `emitDecoratorMetadata`. `tsx` y Vitest usan esbuild, que **no** emite esos metadatos: la API arrancaba, pero cada petición fallaba con 500. Las pruebas no lo detectaron al principio porque ya usaban SWC; lo detectó la prueba de humo con el servidor real.

## Decisión
- Desarrollo: `node --watch -r @swc-node/register src/main.ts`.
- Pruebas: Vitest con `unplugin-swc`.
- Producción: `tsc` (emite metadatos) y `node dist/src/main.js`.
- El worker no usa decoradores y puede seguir con `tsx`.

## Consecuencias
- Agregar una prueba de humo del binario compilado en CI (job `compose`) evita regresiones de este tipo.
