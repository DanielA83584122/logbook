import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(['/api', '/journal.md', '/llms.txt', '/openapi.json', '/docs'].map(path => [path, 'http://127.0.0.1:8000'])),
  },
});
