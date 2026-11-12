import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
const { WORKER_CSP } = createRequire(import.meta.url)('./desktop/security.cjs');

export default defineConfig({
  base: './',
  plugins: [{ name: 'local-tracking-worker-policy', configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url?.split('?')[0] === '/src/tracking/worker.ts') response.setHeader('Content-Security-Policy', WORKER_CSP);
      next();
    });
  } }],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022', sourcemap: false },
});
