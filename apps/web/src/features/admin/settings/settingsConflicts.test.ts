import { describe, expect, it } from 'vitest'
import { ApiError } from '../../../api/http.ts'
import { readSettingsConflict } from './settingsConflicts.ts'

function refusal(code: string, details: Record<string, unknown>): ApiError {
  return new ApiError(409, { code, message: `${code} happened.`, details })
}

describe('reading a settings refusal', () => {
  it('keeps a namespace refusal beside the namespaces', () => {
    const inUse = readSettingsConflict(
      refusal('namespace_in_use', { namespaces: [{ namespace: 'eng', linkCount: 12 }] }),
    )
    expect(inUse).toEqual({
      field: 'namespaces',
      kind: 'namespaceInUse',
      message: 'namespace_in_use happened.',
      namespaces: [{ namespace: 'eng', linkCount: 12 }],
    })
  })

  it('tells the two shapes of a keyword conflict apart', () => {
    const collision = readSettingsConflict(
      refusal('keyword_conflict', {
        collisions: [{ namespace: 'go', keyword: 'notes', links: [] }],
      }),
    )
    expect(collision?.kind).toBe('keywordCollisions')

    const prefixFallback = readSettingsConflict(
      refusal('keyword_conflict', {
        prefixConflicts: [{ namespace: 'go', prefix: 'example', links: [] }],
      }),
    )
    expect(prefixFallback?.kind).toBe('prefixFallback')
    expect(prefixFallback?.field).toBe('keywords')
  })

  it('leaves validation_failed to the fields it names', () => {
    expect(
      readSettingsConflict(
        new ApiError(400, {
          code: 'validation_failed',
          message: 'no',
          details: { fields: { defaultNamespace: 'A namespace name is required.' } },
        }),
      ),
    ).toBeNull()
  })

  it('degrades to the message when the details do not parse', () => {
    expect(readSettingsConflict(refusal('namespace_conflicts', { conflicts: 'nope' }))).toEqual({
      field: 'namespaces',
      kind: 'message',
      message: 'namespace_conflicts happened.',
    })
  })

  it('is nothing at all for a failure that did not come from the API', () => {
    expect(readSettingsConflict(new Error('offline'))).toBeNull()
  })
})
