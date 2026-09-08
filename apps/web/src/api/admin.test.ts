import { DEFAULT_BRANDING_TITLE } from '@golinks/shared/settings'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jsonResponse, requestAt, stubFetch, stubNavigation } from '../test/api.ts'
import { adminUserFixture, auditEventFixture, settingsFixture } from '../test/fixtures.ts'
import { getSettings, getUser, listEvents, listUsers, patchUser, putSettings } from './admin.ts'
import { RequestValidationError, ResponseValidationError } from './resource.ts'

beforeEach(() => {
  stubNavigation()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('users', () => {
  it('lists them with the admin filters', async () => {
    const page = { items: [adminUserFixture()], nextCursor: 'page-2' }
    const fetchMock = stubFetch(jsonResponse(page))

    await expect(
      listUsers({ q: 'jane', role: 'admin', enabled: true, limit: 10 }),
    ).resolves.toEqual(page)
    expect(requestAt(fetchMock).url).toBe(
      '/_/api/v1/admin/users?enabled=true&limit=10&q=jane&role=admin',
    )
  })

  it('reads one by id', async () => {
    const user = adminUserFixture()
    const fetchMock = stubFetch(jsonResponse(user))

    await expect(getUser('7')).resolves.toEqual(user)
    expect(requestAt(fetchMock)).toMatchObject({ url: '/_/api/v1/admin/users/7', method: 'GET' })
  })

  it('changes one', async () => {
    const user = adminUserFixture({ isEnabled: false })
    const fetchMock = stubFetch(jsonResponse(user))

    await expect(patchUser('7', { isEnabled: false })).resolves.toEqual(user)
    expect(requestAt(fetchMock)).toEqual({
      url: '/_/api/v1/admin/users/7',
      method: 'PATCH',
      json: { isEnabled: false },
    })
  })

  it('refuses a change that changes nothing', async () => {
    const fetchMock = stubFetch(jsonResponse(adminUserFixture()))

    await expect(patchUser('7', {})).rejects.toBeInstanceOf(RequestValidationError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a member whose role is not one of the two', async () => {
    stubFetch(jsonResponse(adminUserFixture({ role: 'owner' as never })))

    await expect(getUser('7')).rejects.toBeInstanceOf(ResponseValidationError)
  })
})

describe('settings', () => {
  it('reads the document', async () => {
    const settings = settingsFixture()
    const fetchMock = stubFetch(jsonResponse(settings))

    await expect(getSettings()).resolves.toEqual(settings)
    expect(requestAt(fetchMock)).toMatchObject({
      url: '/_/api/v1/admin/settings',
      method: 'GET',
    })
  })

  it('fills in what a sparse document leaves out (spec 06 §2)', async () => {
    stubFetch(jsonResponse({}))

    const settings = await getSettings()

    expect(settings.defaultNamespace).toBe('go')
    expect(settings.branding.title).toBe(DEFAULT_BRANDING_TITLE)
    expect(settings.readOnly).toBe(false)
  })

  it('replaces the document with a PUT of the whole thing', async () => {
    const settings = settingsFixture({
      branding: { ...settingsFixture().branding, primaryColor: '#1f4b99' },
    })
    const fetchMock = stubFetch(jsonResponse(settings))

    await expect(putSettings(settings)).resolves.toEqual(settings)
    const request = requestAt(fetchMock)
    expect(request).toMatchObject({ url: '/_/api/v1/admin/settings', method: 'PUT' })
    expect(request.json).toEqual(settings)
  })

  it('refuses a document the API would reject', async () => {
    const fetchMock = stubFetch(jsonResponse(settingsFixture()))

    await expect(putSettings(settingsFixture({ namespaces: ['go'] }))).rejects.toBeInstanceOf(
      RequestValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('events', () => {
  it('lists the audit trail with its filters (spec 07)', async () => {
    const page = { items: [auditEventFixture()], nextCursor: null }
    const fetchMock = stubFetch(jsonResponse(page))

    await expect(listEvents({ type: 'link.created', linkId: '42', limit: 20 })).resolves.toEqual(
      page,
    )
    expect(requestAt(fetchMock).url).toBe(
      '/_/api/v1/admin/events?limit=20&linkId=42&type=link.created',
    )
  })

  it('refuses an event type that is not in the catalog', async () => {
    const fetchMock = stubFetch(jsonResponse({ items: [], nextCursor: null }))

    await expect(listEvents({ type: 'link.renamed' as never })).rejects.toBeInstanceOf(
      RequestValidationError,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
