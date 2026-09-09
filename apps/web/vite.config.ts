import react from '@vitejs/plugin-react'
import { searchForWorkspaceRoot } from 'vite'
import { defineConfig } from 'vitest/config'
import { brandingIndexHtmlPlugin } from './src/branding/indexHtml.ts'
import { brandingOverrides } from './src/branding/overrides.ts'

// In development the API runs separately; everything under /_/ that is not a
// client route is proxied to it. The build output is served by the API in production.
const api = process.env.API_ORIGIN ?? 'http://localhost:3000'

// The dev server may only read from inside the monorepo. Everything the app
// imports (its own source plus workspace packages) lives under the workspace
// root, so nothing outside it needs to be reachable through /@fs/.
const workspaceRoot = searchForWorkspaceRoot(import.meta.dirname)

export default defineConfig({
  // The deployment's own ground colors reach index.html here, so the frame
  // painted before the bundle evaluates is already the right one.
  plugins: [react(), brandingIndexHtmlPlugin(brandingOverrides)],
  server: {
    port: 5173,
    // Server-owned paths (spec 04 §1). Every other path the dev server is asked
    // for falls back to index.html, which is what makes /_/login, /_/admin/users
    // and /_/transfer/<token> load on a cold request.
    proxy: Object.fromEntries(
      ['/_/api', '/_/auth', '/_/branding', '/_/health', '/_/opensearch.xml'].map((prefix) => [
        prefix,
        {
          target: api,
          // The API redirects any host that is not its own to BASE_URL (spec 04
          // §2), so the proxy must present the API's host, and it refuses
          // state-changing requests whose Origin is not its own (spec 02 §6),
          // so the proxy presents the API's origin too, as a same-origin page would.
          changeOrigin: true,
          configure: (proxy: {
            on(
              event: 'proxyReq',
              listener: (request: import('node:http').ClientRequest) => void,
            ): void
          }) => {
            proxy.on('proxyReq', (request) => {
              if (request.getHeader('origin') !== undefined) request.setHeader('origin', api)
              if (request.getHeader('referer') !== undefined)
                request.setHeader('referer', `${api}/`)
            })
          },
        },
      ]),
    ),
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
