import { describe, expect, it } from 'vitest'
import {
  AdminUserListResponseSchema,
  AdminUserPatchBodySchema,
  AdminUserSchema,
  AdminUsersQuerySchema,
  MeUserSchema,
  UserIdParamsSchema,
  UserPreferencesSchema,
} from './users.ts'

/** The example from spec 05 section 2.3. */
const specAdminUser = {
  id: '7',
  email: 'jane@acme.com',
  role: 'admin',
  roleSource: 'idp',
  isEnabled: true,
  linkCount: 12,
  lastLoginAt: '2026-09-07T14:03:00Z',
  createdAt: '2026-01-10T09:00:00Z',
}

describe('UserPreferencesSchema', () => {
  it('accepts an empty preferences document', () => {
    expect(UserPreferencesSchema.parse({})).toEqual({})
  })

  it('accepts the whitelisted keys', () => {
    expect(UserPreferencesSchema.parse({ dismissedNotices: ['short-host-setup'] })).toEqual({
      dismissedNotices: ['short-host-setup'],
    })
  })

  it('rejects a key that is not whitelisted', () => {
    expect(UserPreferencesSchema.safeParse({ theme: 'dark' }).success).toBe(false)
  })

  it('rejects a dismissed notice that is not a string', () => {
    expect(UserPreferencesSchema.safeParse({ dismissedNotices: [1] }).success).toBe(false)
    expect(UserPreferencesSchema.safeParse({ dismissedNotices: 'short-host-setup' }).success).toBe(
      false,
    )
  })

  it('rejects an empty notice id', () => {
    expect(UserPreferencesSchema.safeParse({ dismissedNotices: ['  '] }).success).toBe(false)
  })
})

describe('MeUserSchema', () => {
  it('parses the user half of the Me resource', () => {
    const user = {
      id: '7',
      email: 'jane@acme.com',
      role: 'admin',
      organizationId: 'acme.com',
      preferences: {},
      createdAt: '2026-01-10T09:00:00Z',
    }
    expect(MeUserSchema.parse(user)).toEqual(user)
  })

  it('rejects an unknown role', () => {
    expect(
      MeUserSchema.safeParse({
        id: '7',
        email: 'jane@acme.com',
        role: 'superuser',
        organizationId: 'acme.com',
        preferences: {},
        createdAt: '2026-01-10T09:00:00Z',
      }).success,
    ).toBe(false)
  })
})

describe('AdminUserSchema', () => {
  it('parses the resource from the spec', () => {
    expect(AdminUserSchema.parse(specAdminUser)).toEqual(specAdminUser)
  })

  it('allows a member who has never signed in', () => {
    expect(AdminUserSchema.parse({ ...specAdminUser, lastLoginAt: null }).lastLoginAt).toBeNull()
  })

  it.each(['config', 'idp', 'manual'])('accepts the role source %s', (roleSource) => {
    expect(AdminUserSchema.parse({ ...specAdminUser, roleSource }).roleSource).toBe(roleSource)
  })

  it('rejects an unknown role source', () => {
    expect(AdminUserSchema.safeParse({ ...specAdminUser, roleSource: 'scim' }).success).toBe(false)
  })
})

describe('AdminUsersQuerySchema', () => {
  it('defaults the page size', () => {
    expect(AdminUsersQuerySchema.parse({})).toEqual({ limit: 50 })
  })

  it('reads every documented parameter', () => {
    expect(
      AdminUsersQuerySchema.parse({
        q: 'jane',
        role: 'admin',
        enabled: 'false',
        limit: '20',
        cursor: 'eyJ2IjoxfQ',
      }),
    ).toEqual({ q: 'jane', role: 'admin', enabled: false, limit: 20, cursor: 'eyJ2IjoxfQ' })
  })

  it('rejects an unknown parameter', () => {
    expect(AdminUsersQuerySchema.safeParse({ organizationId: 'acme.com' }).success).toBe(false)
  })

  it('rejects an unknown role filter', () => {
    expect(AdminUsersQuerySchema.safeParse({ role: 'owner' }).success).toBe(false)
  })
})

describe('AdminUserPatchBodySchema', () => {
  it('accepts either field on its own', () => {
    expect(AdminUserPatchBodySchema.parse({ isEnabled: false })).toEqual({ isEnabled: false })
    expect(AdminUserPatchBodySchema.parse({ role: 'member' })).toEqual({ role: 'member' })
  })

  it('accepts both together', () => {
    expect(AdminUserPatchBodySchema.parse({ isEnabled: true, role: 'admin' })).toEqual({
      isEnabled: true,
      role: 'admin',
    })
  })

  it('rejects an empty body', () => {
    expect(AdminUserPatchBodySchema.safeParse({}).success).toBe(false)
  })

  it('rejects fields the admin API does not own', () => {
    expect(AdminUserPatchBodySchema.safeParse({ email: 'new@acme.com' }).success).toBe(false)
    expect(AdminUserPatchBodySchema.safeParse({ roleSource: 'manual' }).success).toBe(false)
  })
})

describe('UserIdParamsSchema', () => {
  it('takes the id from the path', () => {
    expect(UserIdParamsSchema.parse({ id: '7' })).toEqual({ id: '7' })
  })
})

describe('AdminUserListResponseSchema', () => {
  it('wraps users in the standard envelope', () => {
    expect(
      AdminUserListResponseSchema.parse({ items: [specAdminUser], nextCursor: 'eyJ2IjoxfQ' }),
    ).toEqual({ items: [specAdminUser], nextCursor: 'eyJ2IjoxfQ' })
  })
})
