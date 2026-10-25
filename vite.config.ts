import { defineConfig } from 'vite';

// App local: rutas relativas para que el build abra con `npm run preview`
// o desde cualquier servidor estático.
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1200 },
  test: { include: ['tests/unit/**/*.test.ts'] },
});
