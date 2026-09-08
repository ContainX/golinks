import type { OrganizationSettings } from '@golinks/shared/settings'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorResponse } from '../../../test/api.ts'
import { meFixture, settingsFixture } from '../../../test/fixtures.ts'
import { renderAdminAt, route, stubApi } from '../adminTestHarness.tsx'

const asAdmin = route('GET', '/me', () => meFixture())
const storedSettings = route('GET', '/admin/settings', () => settingsFixture())

/** Answers the save with a refusal, and remembers what was sent. */
function refusedSave(status: number, code: string, extra: Record<string, unknown> = {}) {
  return route('PUT', '/admin/settings', () => errorResponse(status, code, extra))
}

/** The form as it stands once the document has loaded. */
async function openSettings(): Promise<void> {
  renderAdminAt('/_/admin/settings')
  await screen.findByRole('heading', { name: 'Namespaces' })
}

function save(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the settings form', () => {
  it('loads the document, edits it, and sends the whole thing back', async () => {
    const sent: unknown[] = []
    const fetchMock = stubApi(
      asAdmin,
      storedSettings,
      route('PUT', '/admin/settings', (request) => {
        sent.push(request.body)
        return request.body
      }),
    )

    await openSettings()

    fireEvent.change(screen.getByLabelText('Default namespace'), { target: { value: 'at' } })
    fireEvent.change(screen.getByLabelText('Add namespace'), { target: { value: 'docs' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0] as HTMLElement)
    fireEvent.click(screen.getByLabelText('Punctuation sensitive'))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Acme GoLinks' } })
    fireEvent.change(screen.getByLabelText('Primary color'), { target: { value: '#1f4b99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add banner' }))
    fireEvent.change(screen.getByLabelText('Banner text'), { target: { value: 'Wiki moves.' } })

    save()

    expect(await screen.findByText('Settings saved.')).toBeInTheDocument()
    expect(sent).toHaveLength(1)
    const document = sent[0] as OrganizationSettings
    expect(document.defaultNamespace).toBe('at')
    expect(document.namespaces).toEqual(['eng', 'docs'])
    expect(document.keywords.punctuationSensitive).toBe(false)
    expect(document.branding.title).toBe('Acme GoLinks')
    expect(document.branding.primaryColor).toBe('#1f4b99')
    expect(document.banner).toEqual({ text: 'Wiki moves.', url: null, level: 'info' })

    // Branding reaches every screen through `/me`, so the session is reread and
    // the new primary color applies without a reload (spec 06 §2).
    await waitFor(() => {
      const sessionReads = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/me'))
      expect(sessionReads.length).toBeGreaterThan(1)
    })
  })

  it('removes a namespace, an admin, and a navigation link', async () => {
    const sent: unknown[] = []
    stubApi(
      asAdmin,
      route('GET', '/admin/settings', () =>
        settingsFixture({
          navigationLinks: [{ text: 'Docs', url: 'https://wiki.acme.com', adminOnly: false }],
        }),
      ),
      route('PUT', '/admin/settings', (request) => {
        sent.push(request.body)
        return request.body
      }),
    )

    await openSettings()

    fireEvent.click(screen.getByLabelText('Remove eng'))
    fireEvent.click(screen.getByLabelText('Remove ops@acme.com'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove navigation link 1' }))
    save()

    await screen.findByText('Settings saved.')
    const document = sent[0] as OrganizationSettings
    expect(document.namespaces).toEqual([])
    expect(document.admins).toEqual([])
    expect(document.navigationLinks).toEqual([])
  })

  it('adds a navigation link with its admin-only flag', async () => {
    const sent: unknown[] = []
    stubApi(
      asAdmin,
      storedSettings,
      route('PUT', '/admin/settings', (request) => {
        sent.push(request.body)
        return request.body
      }),
    )

    await openSettings()

    fireEvent.click(screen.getByRole('button', { name: 'Add navigation link' }))
    fireEvent.change(screen.getByLabelText('Text 1'), { target: { value: 'Runbook' } })
    fireEvent.change(screen.getByLabelText('URL 1'), { target: { value: '/_/admin' } })
    fireEvent.click(screen.getByLabelText('Admins only 1'))
    save()

    await screen.findByText('Settings saved.')
    expect((sent[0] as OrganizationSettings).navigationLinks).toEqual([
      { text: 'Runbook', url: '/_/admin', adminOnly: true },
    ])
  })

  it('puts a validation_failed message on the field it names', async () => {
    stubApi(
      asAdmin,
      storedSettings,
      refusedSave(400, 'validation_failed', {
        details: {
          fields: {
            'branding.primaryColor': 'A color must be written as #rrggbb.',
            'namespaces[0]': '"eng" is listed more than once.',
          },
        },
      }),
    )

    await openSettings()
    save()

    expect(await screen.findByText('A color must be written as #rrggbb.')).toBeInTheDocument()
    expect(screen.getByText('namespaces[0]: "eng" is listed more than once.')).toBeInTheDocument()
  })
})

describe('a refusal that names links', () => {
  it('lists the keywords a new namespace would make ambiguous', async () => {
    stubApi(
      asAdmin,
      storedSettings,
      refusedSave(409, 'namespace_conflicts', {
        details: {
          conflicts: [
            {
              namespace: 'eng',
              links: [
                { id: '1', namespace: 'go', keyword: 'eng/deploy', fullPath: 'go/eng/deploy' },
                { id: '2', namespace: 'go', keyword: 'eng/oncall', fullPath: 'go/eng/oncall' },
              ],
            },
          ],
        },
      }),
    )

    await openSettings()
    save()

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByText('Those namespaces would make existing keywords ambiguous'),
    ).toBeInTheDocument()
    expect(within(alert).getByText('go/eng/deploy')).toBeInTheDocument()
    expect(within(alert).getByText('go/eng/oncall')).toBeInTheDocument()
  })

  it('says how much a namespace still holds', async () => {
    stubApi(
      asAdmin,
      storedSettings,
      refusedSave(409, 'namespace_in_use', {
        details: { namespaces: [{ namespace: 'eng', linkCount: 12 }] },
      }),
    )

    await openSettings()
    save()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Those namespaces still hold links')).toBeInTheDocument()
    expect(within(alert).getByText('eng holds 12 links')).toBeInTheDocument()
  })

  it('lists the keywords a punctuation change would collapse together', async () => {
    stubApi(
      asAdmin,
      storedSettings,
      refusedSave(409, 'keyword_conflict', {
        details: {
          collisions: [
            {
              namespace: 'go',
              keyword: 'meetingnotes',
              links: [
                {
                  id: '1',
                  namespace: 'go',
                  keyword: 'meeting-notes',
                  fullPath: 'go/meeting-notes',
                },
                { id: '2', namespace: 'go', keyword: 'meetingnotes', fullPath: 'go/meetingnotes' },
              ],
            },
          ],
        },
      }),
    )

    await openSettings()
    save()

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByText('Two keywords would end up sharing one canonical form'),
    ).toBeInTheDocument()
    expect(within(alert).getByText('go/meetingnotes')).toBeInTheDocument()
    expect(within(alert).getByText('go/meeting-notes')).toBeInTheDocument()
  })

  it('lists what prefix fallback resolution cannot accept', async () => {
    stubApi(
      asAdmin,
      storedSettings,
      refusedSave(409, 'keyword_conflict', {
        details: {
          placeholderViolations: [
            {
              id: '3',
              namespace: 'go',
              keyword: 'team/eng/oncall',
              fullPath: 'go/team/eng/oncall',
              message: 'Only the second segment may be a placeholder.',
            },
          ],
          prefixConflicts: [
            {
              namespace: 'go',
              prefix: 'example',
              links: [
                { id: '4', namespace: 'go', keyword: 'example', fullPath: 'go/example' },
                { id: '5', namespace: 'go', keyword: 'example/%s', fullPath: 'go/example/%s' },
              ],
            },
          ],
        },
      }),
    )

    await openSettings()
    save()

    const alert = await screen.findByRole('alert')
    expect(
      within(alert).getByText('Prefix fallback resolution cannot be turned on yet'),
    ).toBeInTheDocument()
    expect(
      within(alert).getByText('go/team/eng/oncall: Only the second segment may be a placeholder.'),
    ).toBeInTheDocument()
    expect(within(alert).getByText('go/example/%s')).toBeInTheDocument()
  })

  it('falls back to the message when the details say nothing usable', async () => {
    stubApi(asAdmin, storedSettings, refusedSave(409, 'namespace_conflicts', { details: {} }))

    await openSettings()
    save()

    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('The change was refused')).toBeInTheDocument()
    expect(within(alert).getByText('namespace_conflicts happened.')).toBeInTheDocument()
  })
})
