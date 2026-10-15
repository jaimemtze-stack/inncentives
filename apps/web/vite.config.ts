import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { include: ['@inn/shared'] },
  build: {
    commonjsOptions: { include: [/@inn\/shared/, /node_modules/] },
    sourcemap: false,
  },
  server: {
    port: 5173,
    // Keep the browser Host header so the API can tell portal and agent hosts apart.
    proxy: {
      '/api': { target: process.env.API_URL ?? 'http://localhost:3000', changeOrigin: false },
    },
  },
  test: { environment: 'jsdom', include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'] },
} as never);
