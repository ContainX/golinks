import { defineConfig, devices } from '@playwright/test'

// The instance under test is started separately: `docker compose --profile full up` in CI,
// or `pnpm dev` plus `pnpm --filter @golinks/web build` locally. E2E_BASE_URL points at it.
export const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
