import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.loca.lt', '.trycloudflare.com'],
    hmr: process.env.VITE_TUNNEL_HOST
      ? {
          protocol: 'wss',
          host: process.env.VITE_TUNNEL_HOST,
          clientPort: 443
        }
      : undefined,
    proxy: {
      '/api': 'http://127.0.0.1:8000',
      '/health': 'http://127.0.0.1:8000'
    }
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html')
      }
    }
  }
});
