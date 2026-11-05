import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    base: mode === 'production' ? './' : '/',
    define: {
      'process.env': {},
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      // fsevents is a native macOS watcher; pre-bundling it fails the dependency
      // scan. It is never imported by the app, so keep it out of the optimizer.
      exclude: ['fsevents'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var. File watching is
      // off there to stop the preview flickering while an agent edits files.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
