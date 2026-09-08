import { describe, expect, it } from 'vitest'
import {
  AdminEventsQuerySchema,
  AdminSettingsPutBodySchema,
  AdminUserPatchBodySchema,
  AdminUserSchema,
  AdminUsersQuerySchema,
  API_ERROR_CODES,
  API_ERROR_STATUS,
  ApiErrorBodySchema,
  AuditEventSchema,
  httpStatusForApiErrorCode,
  LinkCreateBodySchema,
  LinkIdParamsSchema,
  LinkListQuerySchema,
  LinkOwnerSchema,
  LinkPatchBodySchema,
  LinkSchema,
  LinkSuggestionsQuerySchema,
  listEnvelopeSchema,
  MePatchBodySchema,
  MeSchema,
  TransferPreviewSchema,
  TransferSchema,
  TransferTokenParamsSchema,
  UserIdParamsSchema,
} from './index.ts'

describe('the api barrel', () => {
  it('exports a schema for every resource in spec 05 section 2', () => {
    expect([
      LinkSchema,
      MeSchema,
      AdminUserSchema,
      TransferSchema,
      TransferPreviewSchema,
      AuditEventSchema,
    ]).not.toContain(undefined)
  })

  it('exports a schema for every request shape', () => {
    expect([
      LinkCreateBodySchema,
      LinkPatchBodySchema,
      LinkListQuerySchema,
      LinkSuggestionsQuerySchema,
      LinkIdParamsSchema,
      MePatchBodySchema,
      AdminUsersQuerySchema,
      AdminUserPatchBodySchema,
      UserIdParamsSchema,
      AdminEventsQuerySchema,
      AdminSettingsPutBodySchema,
      TransferTokenParamsSchema,
    ]).not.toContain(undefined)
  })

  it('exports the error envelope and its catalog', () => {
    expect(ApiErrorBodySchema).toBeDefined()
    expect(httpStatusForApiErrorCode('unauthenticated')).toBe(401)
    expect(API_ERROR_CODES.length).toBe(Object.keys(API_ERROR_STATUS).length)
  })

  it('exports the list envelope helper', () => {
    const envelope = listEnvelopeSchema(LinkOwnerSchema)
    expect(envelope.parse({ items: [], nextCursor: null })).toEqual({ items: [], nextCursor: null })
  })
})
