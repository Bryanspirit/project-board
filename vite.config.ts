import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' keeps asset URLs relative so the same build works on
// GitHub Pages (https://user.github.io/<repo>/) and on a custom domain.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', sourcemap: false },
})
