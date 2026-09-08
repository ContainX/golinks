import { describe, expect, it } from 'vitest'
import { queryKeys, stableParams } from './keys.ts'

describe('stableParams', () => {
  it('is the same object however the caller ordered the filters', () => {
    expect(stableParams({ sort: 'keyword', q: 'notes' })).toEqual(
      stableParams({ q: 'notes', sort: 'keyword' }),
    )
    expect(Object.keys(stableParams({ sort: 'keyword', q: 'notes' }))).toEqual(['q', 'sort'])
  })

  it('drops a filter that is absent, null, or cleared', () => {
    expect(stableParams({ q: '', namespace: undefined, owner: null, sort: 'keyword' })).toEqual({
      sort: 'keyword',
    })
  })
})

describe('queryKeys', () => {
  it('nests the specific under the general, so invalidation reaches by prefix', () => {
    expect(queryKeys.links.list({ q: 'notes' })).toEqual(['links', 'list', { q: 'notes' }])
    expect(queryKeys.links.list().slice(0, 2)).toEqual(queryKeys.links.lists())
    expect(queryKeys.links.lists().slice(0, 1)).toEqual(queryKeys.links.all())
    expect(queryKeys.links.detail('42').slice(0, 1)).toEqual(queryKeys.links.all())
    expect(queryKeys.admin.users.list().slice(0, 2)).toEqual(queryKeys.admin.users.all())
    expect(queryKeys.admin.events.list().slice(0, 1)).toEqual(queryKeys.admin.all())
  })

  it('keys a listing by the filters that produced it', () => {
    expect(queryKeys.links.list({ q: 'notes', sort: 'keyword' })).toEqual(
      queryKeys.links.list({ sort: 'keyword', q: 'notes' }),
    )
    expect(queryKeys.links.list({ q: 'notes' })).not.toEqual(queryKeys.links.list({ q: 'wiki' }))
  })

  it('keys the session, one link, one member, the settings, and an offer', () => {
    expect(queryKeys.me()).toEqual(['me'])
    expect(queryKeys.links.detail('42')).toEqual(['links', 'detail', '42'])
    expect(queryKeys.admin.users.detail('7')).toEqual(['admin', 'users', 'detail', '7'])
    expect(queryKeys.admin.settings()).toEqual(['admin', 'settings'])
    expect(queryKeys.transfers.preview('tok-123')).toEqual(['transfers', 'preview', 'tok-123'])
  })
})
