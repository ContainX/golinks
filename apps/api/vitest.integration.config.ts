import { defineConfig } from 'vitest/config'

// Integration tests run against a real Postgres and live under test/integration.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
