import { afterEach, describe, expect, it } from 'vitest'
import { COLOR_SCHEME_STORAGE_KEY, initColorScheme, MODE_STORAGE_KEY } from './initColorScheme.ts'

interface FakeWindowOptions {
  stored?: Record<string, string>
  prefersDark?: boolean
  /** A browser configured to refuse site data throws on every read. */
  storageThrows?: boolean
  /** A window old enough, or restricted enough, to have no media queries. */
  withoutMatchMedia?: boolean
}

function fakeWindow(options: FakeWindowOptions = {}): Window {
  const stored = options.stored ?? {}
  return {
    localStorage: {
      getItem(key: string): string | null {
        if (options.storageThrows === true) {
          throw new Error('site data is disabled')
        }
        return stored[key] ?? null
      },
    },
    ...(options.withoutMatchMedia === true
      ? {}
      : {
          matchMedia: (query: string) => ({
            matches: query.includes('dark') && options.prefersDark === true,
          }),
        }),
    document,
  } as unknown as Window
}

function schemeAttributes(): string[] {
  return document.documentElement.getAttributeNames().filter((name) => name.startsWith('data-'))
}

afterEach(() => {
  document.documentElement.removeAttribute('data-light')
  document.documentElement.removeAttribute('data-dark')
})

describe('initColorScheme', () => {
  it('applies the scheme the member fixed on their last visit', () => {
    initColorScheme(fakeWindow({ stored: { [MODE_STORAGE_KEY]: 'dark' } }))

    expect(schemeAttributes()).toEqual(['data-dark'])
  })

  it('applies light when that is what the member fixed, whatever the device says', () => {
    initColorScheme(fakeWindow({ stored: { [MODE_STORAGE_KEY]: 'light' }, prefersDark: true }))

    expect(schemeAttributes()).toEqual(['data-light'])
  })

  it('follows the device when the member has fixed nothing', () => {
    initColorScheme(fakeWindow({ prefersDark: true }))
    expect(schemeAttributes()).toEqual(['data-dark'])

    initColorScheme(fakeWindow({ prefersDark: false }))
    expect(schemeAttributes()).toEqual(['data-light'])
  })

  it('follows the device when the stored mode says to', () => {
    initColorScheme(fakeWindow({ stored: { [MODE_STORAGE_KEY]: 'system' }, prefersDark: true }))

    expect(schemeAttributes()).toEqual(['data-dark'])
  })

  it('replaces the scheme that was there rather than adding to it', () => {
    initColorScheme(fakeWindow({ stored: { [MODE_STORAGE_KEY]: 'dark' } }))
    initColorScheme(fakeWindow({ stored: { [MODE_STORAGE_KEY]: 'light' } }))

    expect(schemeAttributes()).toEqual(['data-light'])
  })

  it('honors the scheme names Material UI stored for each mode', () => {
    initColorScheme(
      fakeWindow({
        stored: {
          [MODE_STORAGE_KEY]: 'dark',
          [`${COLOR_SCHEME_STORAGE_KEY}-dark`]: 'dark',
          [`${COLOR_SCHEME_STORAGE_KEY}-light`]: 'light',
        },
      }),
    )

    expect(schemeAttributes()).toEqual(['data-dark'])
  })

  it('starts the app anyway when storage is refused', () => {
    initColorScheme(fakeWindow({ storageThrows: true, prefersDark: true }))

    expect(schemeAttributes()).toEqual(['data-dark'])
  })

  it('starts the app anyway when there are no media queries to ask', () => {
    initColorScheme(fakeWindow({ withoutMatchMedia: true }))

    expect(schemeAttributes()).toEqual(['data-light'])
  })
})
