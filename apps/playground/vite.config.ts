import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxy = {
  target: 'http://127.0.0.1:8002',
  changeOrigin: true,
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/health': backendProxy,
      '/get_config': backendProxy,
      '/startAgent': backendProxy,
      '/stopAgent': backendProxy,
    },
  },
});
