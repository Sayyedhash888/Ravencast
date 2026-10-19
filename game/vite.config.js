import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    // the GLB assets live in public/ and are served verbatim
    chunkSizeWarningLimit: 4000,
  },
});
