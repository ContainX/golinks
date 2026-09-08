import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { brandingFixture } from '../test/fixtures.ts'
import { applyDocumentBranding, readDocumentBrandingDefaults } from './documentBranding.ts'

const SERVED_TITLE = 'GoLinks'
const SERVED_ICON = '/favicon.ico'

function iconHref(): string | null {
  return document.head.querySelector('link[rel~="icon"]')?.getAttribute('href') ?? null
}

function serveDocument(icon: string | null): void {
  document.title = SERVED_TITLE
  for (const link of document.head.querySelectorAll('link[rel~="icon"]')) {
    link.remove()
  }
  if (icon !== null) {
    const link = document.createElement('link')
    link.rel = 'icon'
    link.setAttribute('href', icon)
    document.head.appendChild(link)
  }
}

beforeEach(() => {
  serveDocument(SERVED_ICON)
})

afterEach(() => {
  serveDocument(SERVED_ICON)
})

describe('readDocumentBrandingDefaults', () => {
  it('reads the title and icon the document was served with', () => {
    expect(readDocumentBrandingDefaults(document)).toEqual({
      title: SERVED_TITLE,
      iconHref: SERVED_ICON,
    })
  })

  it('reports no icon when the document declares none', () => {
    serveDocument(null)

    expect(readDocumentBrandingDefaults(document).iconHref).toBeNull()
  })
})

describe('applyDocumentBranding', () => {
  const defaults = { title: SERVED_TITLE, iconHref: SERVED_ICON }

  it('takes the title and the icon from the organization', () => {
    applyDocumentBranding(
      brandingFixture({ title: 'Acme GoLinks', faviconUrl: 'https://static.acme.com/icon.png' }),
      defaults,
      document,
    )

    expect(document.title).toBe('Acme GoLinks')
    expect(iconHref()).toBe('https://static.acme.com/icon.png')
  })

  it('restores what was served for a field the organization leaves unset', () => {
    applyDocumentBranding(
      brandingFixture({ title: 'Acme GoLinks', faviconUrl: 'https://static.acme.com/icon.png' }),
      defaults,
      document,
    )
    applyDocumentBranding(brandingFixture({ title: 'Acme GoLinks' }), defaults, document)

    expect(document.title).toBe('Acme GoLinks')
    expect(iconHref()).toBe(SERVED_ICON)
  })

  it('restores everything when there is no branding to apply', () => {
    applyDocumentBranding(
      brandingFixture({ title: 'Acme GoLinks', faviconUrl: 'https://static.acme.com/icon.png' }),
      defaults,
      document,
    )
    applyDocumentBranding(null, defaults, document)

    expect(document.title).toBe(SERVED_TITLE)
    expect(iconHref()).toBe(SERVED_ICON)
  })

  it('adds an icon to a document that was served without one, and takes it away again', () => {
    serveDocument(null)
    const noIconDefaults = { title: SERVED_TITLE, iconHref: null }

    applyDocumentBranding(
      brandingFixture({ faviconUrl: 'https://static.acme.com/icon.png' }),
      noIconDefaults,
      document,
    )
    expect(iconHref()).toBe('https://static.acme.com/icon.png')

    applyDocumentBranding(null, noIconDefaults, document)
    expect(iconHref()).toBeNull()
  })
})
