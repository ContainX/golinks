import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'

// In development the API runs separately; everything under /_/ that is not a
// client route is proxied to it. The build output is served by the API in production.
const api = process.env.API_ORIGIN ?? 'http://localhost:3000'

// The dev server may only read from inside the monorepo. Everything the app
// imports (its own source plus workspace packages) lives under the workspace
// root, so nothing outside it needs to be reachable through /@fs/.
const workspaceRoot = searchForWorkspaceRoot(import.meta.dirname)

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Server-owned paths (spec 04 §1). Every other path the dev server is asked
    // for falls back to index.html, which is what makes /_/login, /_/admin/users
    // and /_/transfer/<token> load on a cold request.
    proxy: {
      '/_/api': api,
      '/_/auth': api,
      '/_/health': api,
      '/_/opensearch.xml': api,
    },
    fs: {
      strict: true,
      allow: [workspaceRoot],
    },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
})
