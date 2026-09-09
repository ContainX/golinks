// Reading the organization settings a deployment fixes from the outside (spec 06 §6).
//
// Two sources, both optional: `<CONFIG_DIR>/settings.json`, which is what a mounted ConfigMap
// or a `COPY config/ /app/config` in a downstream image leaves behind, and
// `SETTINGS_OVERRIDES_JSON`, which is the same document inline for a deployment that would
// rather set one variable than mount a file. The inline document is laid over the file's, so a
// base image can carry a settings file and one environment variable can still change a colour.
//
// The merged document is validated before anything else starts. A deployment that mistypes a
// field learns at boot, with the field named, rather than by watching admins see settings that
// were quietly ignored.

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { DeploymentConfig } from '@golinks/shared/config'
import {
  type DeploymentSettingsOverrides,
  managedSettingsPaths,
  NO_DEPLOYMENT_OVERRIDES,
  parseDeploymentSettingsOverrides,
} from '@golinks/shared/settings'
import { ConfigurationError } from '../config/load.ts'

/** The settings document a deployment leaves in its configuration directory. */
export const SETTINGS_FILE_NAME = 'settings.json'

/** The directory under `CONFIG_DIR` whose files are served at `/_/branding` (spec 06 §6). */
export const BRANDING_DIRECTORY_NAME = 'branding'

/** Where the values came from, in the order they were laid over each other. */
export type DeploymentOverridesSource = 'file' | 'environment'

export interface LoadedDeploymentOverrides {
  /** The merged, validated document. Empty when the deployment fixes nothing. */
  overrides: DeploymentSettingsOverrides
  /** The dotted paths the deployment fixes, sorted. */
  managedPaths: readonly string[]
  sources: readonly DeploymentOverridesSource[]
  /** The settings file that was read, when there was one. */
  filePath: string | undefined
}

export interface LoadDeploymentOverridesOptions {
  /**
   * Reads a file, answering `undefined` when it does not exist. Injectable so a test can
   * describe a configuration directory without creating one.
   */
  readFile?: (path: string) => string | undefined
}

/** Nothing was configured from the outside. */
const NOTHING_LOADED: LoadedDeploymentOverrides = Object.freeze({
  overrides: NO_DEPLOYMENT_OVERRIDES,
  managedPaths: Object.freeze([]),
  sources: Object.freeze([]),
  filePath: undefined,
})

/** The directory whose files are served at `/_/branding`, or undefined without a CONFIG_DIR. */
export function brandingDirectoryOf(config: DeploymentConfig): string | undefined {
  const directory = configDirectoryOf(config)
  return directory === undefined ? undefined : join(directory, BRANDING_DIRECTORY_NAME)
}

/** The configuration directory as an absolute path, or undefined when there is none. */
export function configDirectoryOf(config: DeploymentConfig): string | undefined {
  return config.configDir === undefined ? undefined : resolve(config.configDir)
}

/** The settings file inside the configuration directory, or undefined when there is none. */
export function settingsFileOf(config: DeploymentConfig): string | undefined {
  const directory = configDirectoryOf(config)
  return directory === undefined ? undefined : join(directory, SETTINGS_FILE_NAME)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The banner changes as a unit, exactly as it does when an overrides document is laid over an
 * organization's settings: an inline banner replaces the file's rather than merging into it.
 */
const REPLACED_AS_A_WHOLE = new Set(['banner'])

/** Lays `overlay` over `base` field by field, with the merge rules of spec 06 §6. */
function mergeDocuments(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
  path = '',
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) continue
    const current = merged[key]
    const fieldPath = path === '' ? key : `${path}.${key}`
    merged[key] =
      isPlainObject(value) && isPlainObject(current) && !REPLACED_AS_A_WHOLE.has(fieldPath)
        ? mergeDocuments(current, value, fieldPath)
        : value
  }
  return merged
}

/** Reads a file, treating a missing one as "the deployment supplied none". */
function readOptionalFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return undefined
    throw new ConfigurationError([`${path} could not be read: ${(error as Error).message}`])
  }
}

/** An absent, empty, or whitespace-only value reads as nothing supplied. */
function blankToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value
}

/** Names the sources a problem could have come from, for the message an operator reads. */
function describeSources(filePath: string | undefined, hasInline: boolean): string {
  const names: string[] = []
  if (filePath !== undefined) names.push(filePath)
  if (hasInline) names.push('SETTINGS_OVERRIDES_JSON')
  return names.join(' and ')
}

function refuse(origin: string, problems: readonly string[]): never {
  throw new ConfigurationError(
    problems.map((problem) => `deployment settings overrides (${origin}): ${problem}`),
  )
}

/** Parses one source into an object, refusing anything that is not a JSON object. */
function parseDocument(text: string, origin: string, source: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    refuse(origin, [`${source} is not valid JSON: ${(error as Error).message}`])
  }
  if (!isPlainObject(parsed)) refuse(origin, [`${source} must be a JSON object`])
  return parsed
}

/**
 * The settings a deployment fixes, from `<CONFIG_DIR>/settings.json` and
 * `SETTINGS_OVERRIDES_JSON`, merged and validated.
 *
 * Throws `ConfigurationError` with one line per field problem, which `index.ts` prints before
 * exiting: a settings document the service cannot honour is a configuration mistake, and
 * starting anyway would serve settings the deployment did not ask for.
 */
export function loadDeploymentSettingsOverrides(
  config: DeploymentConfig,
  options: LoadDeploymentOverridesOptions = {},
): LoadedDeploymentOverrides {
  const read = options.readFile ?? readOptionalFile
  const settingsFile = settingsFileOf(config)
  // A file that is there but empty is a mount that has not been filled in, not a mistake.
  const fileText = blankToUndefined(settingsFile === undefined ? undefined : read(settingsFile))
  const inlineText = config.settingsOverridesJson

  if (fileText === undefined && inlineText === undefined) return NOTHING_LOADED

  const filePath = fileText === undefined ? undefined : settingsFile
  const origin = describeSources(filePath, inlineText !== undefined)
  const sources: DeploymentOverridesSource[] = []

  let document: Record<string, unknown> = {}
  if (fileText !== undefined && filePath !== undefined) {
    document = parseDocument(fileText, origin, filePath)
    sources.push('file')
  }
  if (inlineText !== undefined) {
    document = mergeDocuments(
      document,
      parseDocument(inlineText, origin, 'SETTINGS_OVERRIDES_JSON'),
    )
    sources.push('environment')
  }

  const parsed = parseDeploymentSettingsOverrides(document)
  if (!parsed.ok) {
    refuse(
      origin,
      Object.entries(parsed.error.fields).map(([field, message]) => `${field}: ${message}`),
    )
  }

  return {
    overrides: parsed.overrides,
    managedPaths: managedSettingsPaths(parsed.overrides),
    sources,
    filePath,
  }
}
