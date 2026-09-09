import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import { describe, expect, it } from 'vitest'
import type { OrganizationSettingsService } from '../organizations/settings-service.ts'
import { buildTestApp } from '../testing/fixtures.ts'
import type { CurrentMember } from '../types.ts'
import { escapeXml, OPENSEARCH_CONTENT_TYPE, renderOpenSearchDocument } from './opensearch.ts'

const member: CurrentMember = {
  id: '1',
  email: 'jane@widgets.test',
  organizationId: 'widgets.test',
  role: 'member',
}

function settingsWithTitle(title: string): OrganizationSettingsService {
  const settings = {
    ...DEFAULT_ORGANIZATION_SETTINGS,
    branding: { ...DEFAULT_ORGANIZATION_SETTINGS.branding, title },
  }
  return {
    ensureOrganization: async () => {},
    getSettings: async () => settings,
    saveSettings: async () => settings,
    managedPaths: () => [],
    managedViolations: () => ({}),
    invalidate: () => {},
  }
}

describe('renderOpenSearchDocument', () => {
  it('keeps the searchTerms template literal and escapes text', () => {
    const xml = renderOpenSearchDocument({
      baseUrl: 'https://links.example.com/',
      shortHost: 'go',
      title: 'Acme & Sons <Links>',
    })
    expect(xml).toContain('<ShortName>go</ShortName>')
    expect(xml).toContain('Go links for Acme &amp; Sons &lt;Links&gt;')
    expect(xml).toContain('template="https://links.example.com/{searchTerms}?via=search"')
    expect(xml).toContain('https://links.example.com/favicon.ico')
  })

  it('escapes every reserved character', () => {
    expect(escapeXml(`<a href="x">'&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;',
    )
  })
})

describe('GET /_/opensearch.xml', () => {
  it('uses the default title for anonymous requests', async () => {
    const app = await buildTestApp()
    const response = await app.inject({ method: 'GET', url: '/_/opensearch.xml' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain(OPENSEARCH_CONTENT_TYPE)
    expect(response.body).toContain('Go links for GoLinks')
    await app.close()
  })

  it('uses the organization branding title for a signed-in member', async () => {
    const app = await buildTestApp({
      memberResolver: async () => member,
      organizationSettings: settingsWithTitle('Widgets Inc'),
    })
    const response = await app.inject({ method: 'GET', url: '/_/opensearch.xml' })
    expect(response.body).toContain('Go links for Widgets Inc')
    await app.close()
  })
})
