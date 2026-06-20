import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Relative base keeps the static build portable across GitHub Pages project
// subpaths and the owner's own domain. See PRD "Stack".
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
});
