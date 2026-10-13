import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// No `define` for API keys: keys stay on the server and never enter the browser bundle.
export default defineConfig(() => {
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
