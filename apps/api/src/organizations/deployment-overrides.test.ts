import type { EnvironmentInput } from '@golinks/shared/config'
import { describe, expect, it } from 'vitest'
import { ConfigurationError } from '../config/load.ts'
import { testConfig } from '../testing/fixtures.ts'
import {
  brandingDirectoryOf,
  loadDeploymentSettingsOverrides,
  settingsFileOf,
} from './deployment-overrides.ts'

const CONFIG_DIR = '/etc/golinks'
const SETTINGS_FILE = `${CONFIG_DIR}/settings.json`

/** A reader that answers for the settings file only, and reports every other path as missing. */
function fileHolding(contents: Record<string, string>) {
  return (path: string): string | undefined => contents[path]
}

function load(environment: EnvironmentInput, files: Record<string, string> = {}) {
  return loadDeploymentSettingsOverrides(testConfig(environment), { readFile: fileHolding(files) })
}

function issuesOf(environment: EnvironmentInput, files: Record<string, string> = {}): string[] {
  try {
    load(environment, files)
  } catch (error) {
    if (error instanceof ConfigurationError) return error.issues
    throw error
  }
  throw new Error('expected the overrides to be refused')
}

describe('paths under CONFIG_DIR', () => {
  it('are undefined when the deployment mounts no configuration', () => {
    expect(settingsFileOf(testConfig())).toBeUndefined()
    expect(brandingDirectoryOf(testConfig())).toBeUndefined()
  })

  it('are the settings document and the branding directory', () => {
    const config = testConfig({ CONFIG_DIR })

    expect(settingsFileOf(config)).toBe(SETTINGS_FILE)
    expect(brandingDirectoryOf(config)).toBe(`${CONFIG_DIR}/branding`)
  })
})

describe('loadDeploymentSettingsOverrides (spec 06 §6)', () => {
  it('fixes nothing when neither source is configured', () => {
    const loaded = load({})

    expect(loaded.overrides).toEqual({})
    expect(loaded.managedPaths).toEqual([])
    expect(loaded.sources).toEqual([])
    expect(loaded.filePath).toBeUndefined()
  })

  it('reads the settings file in the configuration directory', () => {
    const loaded = load(
      { CONFIG_DIR },
      { [SETTINGS_FILE]: JSON.stringify({ branding: { title: 'Acme Links' }, readOnly: true }) },
    )

    expect(loaded.overrides).toEqual({ branding: { title: 'Acme Links' }, readOnly: true })
    expect(loaded.managedPaths).toEqual(['branding.title', 'readOnly'])
    expect(loaded.sources).toEqual(['file'])
    expect(loaded.filePath).toBe(SETTINGS_FILE)
  })

  it('treats a missing settings file as nothing supplied', () => {
    const loaded = load({ CONFIG_DIR })

    expect(loaded.overrides).toEqual({})
    expect(loaded.sources).toEqual([])
  })

  it('treats an empty settings file as a mount nobody has filled in', () => {
    const loaded = load({ CONFIG_DIR }, { [SETTINGS_FILE]: '   \n' })

    expect(loaded.overrides).toEqual({})
    expect(loaded.sources).toEqual([])
  })

  it('reads the inline document', () => {
    const loaded = load({
      SETTINGS_OVERRIDES_JSON: JSON.stringify({
        branding: { dark: { backgroundColor: '#000000' } },
      }),
    })

    expect(loaded.overrides).toEqual({ branding: { dark: { backgroundColor: '#000000' } } })
    expect(loaded.managedPaths).toEqual(['branding.dark.backgroundColor'])
    expect(loaded.sources).toEqual(['environment'])
    expect(loaded.filePath).toBeUndefined()
  })

  it('lays the inline document over the file, field by field', () => {
    const loaded = load(
      {
        CONFIG_DIR,
        SETTINGS_OVERRIDES_JSON: JSON.stringify({
          branding: { title: 'Staging', light: { backgroundColor: '#ffffff' } },
        }),
      },
      {
        [SETTINGS_FILE]: JSON.stringify({
          readOnly: true,
          branding: {
            title: 'Acme Links',
            logoUrl: '/_/branding/logo.svg',
            light: { primaryColor: '#1f4b99' },
          },
        }),
      },
    )

    expect(loaded.overrides).toEqual({
      readOnly: true,
      branding: {
        // The inline title wins; the logo the file supplied is kept.
        title: 'Staging',
        logoUrl: '/_/branding/logo.svg',
        light: { primaryColor: '#1f4b99', backgroundColor: '#ffffff' },
      },
    })
    expect(loaded.managedPaths).toEqual([
      'branding.light.backgroundColor',
      'branding.light.primaryColor',
      'branding.logoUrl',
      'branding.title',
      'readOnly',
    ])
    expect(loaded.sources).toEqual(['file', 'environment'])
  })

  it('replaces the banner as a whole rather than merging into it', () => {
    const loaded = load(
      {
        CONFIG_DIR,
        SETTINGS_OVERRIDES_JSON: JSON.stringify({ banner: { text: 'Read-only until Monday.' } }),
      },
      {
        [SETTINGS_FILE]: JSON.stringify({
          banner: {
            text: 'Migration on Friday.',
            url: 'https://wiki.acme.test/x',
            level: 'warning',
          },
        }),
      },
    )

    // Replaced whole: the file's url and level are gone, not merged under the new text.
    expect(loaded.overrides.banner).toEqual({
      text: 'Read-only until Monday.',
      url: null,
      level: 'info',
    })
    expect(loaded.managedPaths).toEqual(['banner'])
  })

  it('refuses a field the deployment may not fix, and says why', () => {
    const issues = issuesOf({ SETTINGS_OVERRIDES_JSON: JSON.stringify({ defaultNamespace: 'go' }) })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('defaultNamespace')
    expect(issues[0]).toContain('renames the namespace of every link')
    expect(issues[0]).toContain('SETTINGS_OVERRIDES_JSON')
  })

  it('reports one line per field problem, naming the sources they could have come from', () => {
    const issues = issuesOf(
      { CONFIG_DIR },
      {
        [SETTINGS_FILE]: JSON.stringify({
          branding: { title: '', primaryColor: 'blue' },
        }),
      },
    )

    expect(issues).toHaveLength(2)
    expect(issues.every((issue) => issue.includes(SETTINGS_FILE))).toBe(true)
    expect(issues.join('\n')).toContain('branding.title')
    expect(issues.join('\n')).toContain('branding.primaryColor')
  })

  it('refuses a document that is not JSON', () => {
    const issues = issuesOf({ SETTINGS_OVERRIDES_JSON: '{not json' })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('SETTINGS_OVERRIDES_JSON is not valid JSON')
  })

  it('refuses a document that is not a JSON object', () => {
    const issues = issuesOf({ CONFIG_DIR }, { [SETTINGS_FILE]: '["branding"]' })

    expect(issues[0]).toContain('must be a JSON object')
  })

  it('refuses a settings document that could never produce valid settings', () => {
    const issues = issuesOf({
      SETTINGS_OVERRIDES_JSON: JSON.stringify({ admins: ['not-an-email'] }),
    })

    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('admins')
  })
})
