import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Plain multi-entry build, no extension-specific plugin: what's in dist/ is
// exactly manifest.json + sidepanel.html + background.js + assets. Easy to reason about.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development' ? 'inline' : false,
    minify: mode !== 'development',
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'sidepanel.html'),
        permission: resolve(__dirname, 'permission.html'),
        background: resolve(__dirname, 'src/background/index.ts'),
      },
      output: {
        // manifest.json references background.js by a fixed name.
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
}));
