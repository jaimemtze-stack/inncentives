import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Consume the shared package from source (Vite compiles the TypeScript).
      '@mesa/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Development hosts for the two areas: soporte.localhost and agentes.soporte.localhost.
    allowedHosts: ['.localhost'],
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false, xfwd: true },
      '/socket.io': { target: apiTarget, changeOrigin: false, xfwd: true, ws: true },
    },
  },
  build: {
    sourcemap: false,
    // No inline scripts or styles: compatible with a strict CSP.
    assetsInlineLimit: 0,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
