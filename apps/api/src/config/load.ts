// Reads the process environment and turns it into the deployment configuration. The schema
// itself lives in the shared package so that the web app can reuse the pieces it needs.

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type DeploymentConfig,
  type EnvironmentInput,
  environmentSchema,
  formatEnvironmentIssues,
} from '@golinks/shared/config'

/** Raised when the environment cannot be turned into a usable configuration. */
export class ConfigurationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`)
    this.name = 'ConfigurationError'
    this.issues = issues
  }
}

/** Parses an environment, throwing ConfigurationError with one line per problem. */
export function loadConfig(environment: EnvironmentInput = process.env): DeploymentConfig {
  const result = environmentSchema.safeParse(environment)
  if (!result.success) throw new ConfigurationError(formatEnvironmentIssues(result.error))
  return result.data
}

/** Walks up from this module until it finds the API package root. */
function findPackageRoot(): string {
  const start = dirname(fileURLToPath(import.meta.url))
  let directory = start
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(directory, 'package.json'))) return directory
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return start
}

export interface AssetPaths {
  /** Directory holding the built single-page app, or undefined when it has not been built. */
  webDistPath: string | undefined
  /** Directory holding favicon.ico and robots.txt. */
  publicPath: string
}

/**
 * Locates the static assets the service serves. `WEB_DIST_PATH` overrides the default, which
 * is the sibling web package's build output.
 */
export function resolveAssetPaths(
  config: DeploymentConfig,
  packageRoot = findPackageRoot(),
): AssetPaths {
  const configured = config.webDistPath
  const webDistPath = configured
    ? resolve(packageRoot, configured)
    : resolve(packageRoot, '..', 'web', 'dist')
  return {
    webDistPath: existsSync(join(webDistPath, 'index.html')) ? webDistPath : undefined,
    publicPath: join(packageRoot, 'public'),
  }
}
