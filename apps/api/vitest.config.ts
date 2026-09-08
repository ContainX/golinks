import { defineConfig } from 'vitest/config'

// Unit tests live next to the code they test as *.test.ts under src.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
