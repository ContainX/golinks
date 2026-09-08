// Route guards (spec 02 §5).
//
// Every API route starts with one of these. `request.member` is already populated by the
// member resolver, so a guard is a check rather than a lookup, and the thrown `ApiError` turns
// into the envelope of spec 05 §4 without the route saying anything more.

import type { FastifyRequest } from 'fastify'
import { ApiError } from '../errors.ts'
import type { CurrentMember } from '../types.ts'

/** The signed-in member, or 401 `unauthenticated`. */
export function requireMember(request: FastifyRequest): CurrentMember {
  const member = request.member
  if (member === null || member === undefined) {
    throw new ApiError('unauthenticated', 'Sign in to use this endpoint.')
  }
  return member
}

/** The signed-in member when they administer their organization, or 401/403. */
export function requireAdmin(request: FastifyRequest): CurrentMember {
  const member = requireMember(request)
  if (member.role !== 'admin') {
    throw new ApiError('forbidden', 'Only an administrator of your organization may do this.')
  }
  return member
}

/** True when the member owns the object, or administers the organization it belongs to. */
export function isAdmin(member: CurrentMember | null | undefined): boolean {
  return member?.role === 'admin'
}
