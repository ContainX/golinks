import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API runs separately; everything under /_/ that is not a
// client route is proxied to it. The build output is served by the API in production.
const api = process.env.API_ORIGIN ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/_/api': api,
      '/_/auth': api,
      '/_/health': api,
      '/_/opensearch.xml': api,
    },
  },
  build: { outDir: 'dist', sourcemap: true },
})
