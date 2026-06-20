import { defineConfig } from 'vite';

// Web workers are instantiated with `new Worker(new URL('./worker.ts', import.meta.url))`
// which Vite handles natively. `worker.format: 'es'` keeps ESM imports working inside
// the worker so it can import the DOM-free `core/` modules.
export default defineConfig({
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
