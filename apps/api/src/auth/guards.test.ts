import type { FastifyRequest } from 'fastify'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'
import { isAdmin, requireAdmin, requireMember } from './guards.ts'

const MEMBER: CurrentMember = {
  id: '7',
  email: 'ada@widgets.test',
  organizationId: 'widgets.test',
  role: 'member',
}

function requestFor(member: CurrentMember | null): FastifyRequest {
  return { member } as FastifyRequest
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return error instanceof ApiError ? error.code : 'not-an-ApiError'
  }
  return 'no-error'
}

describe('route guards', () => {
  it('hands back the signed-in member', () => {
    expect(requireMember(requestFor(MEMBER))).toEqual(MEMBER)
  })

  it('refuses a request with no session as unauthenticated', () => {
    expect(codeOf(() => requireMember(requestFor(null)))).toBe('unauthenticated')
  })

  it('refuses a member who is not an admin as forbidden', () => {
    expect(codeOf(() => requireAdmin(requestFor(MEMBER)))).toBe('forbidden')
  })

  it('lets an admin through', () => {
    const admin: CurrentMember = { ...MEMBER, role: 'admin' }
    expect(requireAdmin(requestFor(admin))).toEqual(admin)
    expect(isAdmin(admin)).toBe(true)
    expect(isAdmin(MEMBER)).toBe(false)
    expect(isAdmin(null)).toBe(false)
  })

  it('prefers unauthenticated over forbidden when nobody is signed in', () => {
    expect(codeOf(() => requireAdmin(requestFor(null)))).toBe('unauthenticated')
  })
})
