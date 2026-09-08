// Fills the environment from the nearest .env file when one exists, using Node's own loader.
// Values already present in the environment win, so a container or a CI job that sets
// everything explicitly is unaffected, and a developer who copied .env.example needs nothing
// more than `pnpm dev`.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const CANDIDATES = ['.env', '../.env', '../../.env']

export function loadDotEnvIfPresent(from: string = process.cwd()): string | undefined {
  for (const candidate of CANDIDATES) {
    const path = resolve(from, candidate)
    if (existsSync(path)) {
      process.loadEnvFile(path)
      return path
    }
  }
  return undefined
}
