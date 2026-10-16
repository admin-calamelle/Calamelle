import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webPort = Number(process.env.CALAMELLE_WEB_PORT || 5173);
const apiTarget = process.env.CALAMELLE_API_URL || 'http://127.0.0.1:4000';

export default defineConfig({
  plugins: [react()],

  server: {
    host: '0.0.0.0',
    port: webPort,
    strictPort: true,

    allowedHosts: [
      '.trycloudflare.com'
    ],

    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
        secure: false
      }
    }
  },

  build: {
    outDir: 'dist'
  }
});
