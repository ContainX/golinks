import { describe, expect, it } from 'vitest'
import type { CurrentMember } from '../types.ts'
import { createMemberCache, DEFAULT_MEMBER_CACHE_TTL_MS } from './member-cache.ts'

const MEMBER: CurrentMember = {
  id: '7',
  email: 'ada@widgets.test',
  organizationId: 'widgets.test',
  role: 'member',
}

describe('member cache', () => {
  it('holds a member for the spec 02 §3 lifetime and no longer', () => {
    let now = 1_000
    const cache = createMemberCache({ now: () => now })
    expect(cache.ttlMs).toBe(DEFAULT_MEMBER_CACHE_TTL_MS)

    cache.remember(MEMBER)
    expect(cache.get('7')).toEqual(MEMBER)

    now += DEFAULT_MEMBER_CACHE_TTL_MS
    expect(cache.get('7')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  it('remembers nothing at all when the lifetime is zero', () => {
    const cache = createMemberCache({ ttlMs: 0 })
    cache.remember(MEMBER)
    expect(cache.get('7')).toBeUndefined()
  })

  it('forgets one member and clears the rest', () => {
    const cache = createMemberCache()
    cache.remember(MEMBER)
    cache.remember({ ...MEMBER, id: '8' })

    cache.forget('7')
    expect(cache.get('7')).toBeUndefined()
    expect(cache.get('8')).toBeDefined()

    cache.clear()
    expect(cache.size()).toBe(0)
  })
})
