import { defineConfig } from 'vite';

// WebHID requires a secure context (localhost is OK).
// Run `npm run dev` and visit http://127.0.0.1:5173 in Chrome/Edge.
export default defineConfig({
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
