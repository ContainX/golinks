import { describe, expect, it } from 'vitest'
import { keywordLockKey } from './locking.ts'

const SIGNED_64_MIN = -(2n ** 63n)
const SIGNED_64_MAX = 2n ** 63n - 1n

const KEY = { organizationId: 'widgets.test', namespace: 'go', prefix: 'jira' }

describe('keywordLockKey', () => {
  it('is the same number every time, so every replica queues on the same lock', () => {
    expect(keywordLockKey(KEY)).toBe(keywordLockKey({ ...KEY }))
  })

  it('fits the signed 64-bit range Postgres advisory locks take', () => {
    const keys = [
      KEY,
      { organizationId: '', namespace: '', prefix: '' },
      { organizationId: 'a'.repeat(255), namespace: 'namespace', prefix: 'p'.repeat(200) },
      { organizationId: 'gizmos.test', namespace: 'eng', prefix: 'deploy' },
    ]
    for (const key of keys) {
      const value = keywordLockKey(key)
      expect(value).toBeGreaterThanOrEqual(SIGNED_64_MIN)
      expect(value).toBeLessThanOrEqual(SIGNED_64_MAX)
    }
  })

  it.each([
    ['another organization', { ...KEY, organizationId: 'gizmos.test' }],
    ['another namespace', { ...KEY, namespace: 'eng' }],
    ['another prefix', { ...KEY, prefix: 'gh' }],
  ])('takes a different lock for %s', (_label, other) => {
    expect(keywordLockKey(other)).not.toBe(keywordLockKey(KEY))
  })

  it('does not let two triples run together into the same key', () => {
    // Without a separator, ("ab", "c", "d") and ("a", "bc", "d") would hash the same bytes.
    expect(keywordLockKey({ organizationId: 'ab', namespace: 'c', prefix: 'd' })).not.toBe(
      keywordLockKey({ organizationId: 'a', namespace: 'bc', prefix: 'd' }),
    )
  })

  it('treats a keyword prefix case-sensitively, as the canonical form already is', () => {
    // Canonical keywords are lowercase by construction (spec 03 §2.2), so the key never
    // needs to fold case; it must not fold two genuinely different organizations together.
    expect(keywordLockKey({ ...KEY, organizationId: 'Widgets.test' })).not.toBe(keywordLockKey(KEY))
  })
})
