import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Stamped into the bundle and shown in the corner of the Mini App, so anyone
 * can tell at a glance whether Telegram is running the deploy they just made
 * or a WebView-cached copy of the previous one.
 */
const buildId = process.env.APP_BUILD_ID || new Date().toISOString().replace(/[-:T]/g, '').slice(2, 12);

export default defineConfig({
  plugins: [react()],
  define: { __APP_BUILD__: JSON.stringify(buildId) },
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy: { '/api': 'http://localhost:4000', '/telegram': 'http://localhost:4000' } },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: true }
});

