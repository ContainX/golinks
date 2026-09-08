import { describe, expect, it } from 'vitest'
import { DEFAULT_ORGANIZATION_SETTINGS } from '../settings/index.ts'
import { AdminSettingsPutBodySchema, AdminSettingsResponseSchema } from './admin.ts'

describe('the admin settings endpoints', () => {
  it('accepts an empty document and answers with the defaults', () => {
    expect(AdminSettingsPutBodySchema.parse({})).toEqual(DEFAULT_ORGANIZATION_SETTINGS)
  })

  it('returns a fully populated document', () => {
    expect(AdminSettingsResponseSchema.parse(DEFAULT_ORGANIZATION_SETTINGS)).toEqual(
      DEFAULT_ORGANIZATION_SETTINGS,
    )
  })

  it('rejects a misspelled field rather than dropping it', () => {
    expect(AdminSettingsPutBodySchema.safeParse({ readonly: true }).success).toBe(false)
  })
})
