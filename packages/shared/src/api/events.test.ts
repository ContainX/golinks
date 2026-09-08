import { describe, expect, it } from 'vitest'
import {
  AdminEventsQuerySchema,
  AuditEventListResponseSchema,
  AuditEventSchema,
  AuditEventTypeSchema,
} from './events.ts'

const specEvent = {
  id: '901',
  type: 'link.updated',
  actorUserId: '7',
  objectType: 'link',
  objectId: '42',
  data: { changes: { destination: ['https://old.acme.com', 'https://new.acme.com'] } },
  requestId: '01JABCDEF',
  createdAt: '2026-09-07T14:03:00Z',
}

describe('AuditEventSchema', () => {
  it('parses an event', () => {
    expect(AuditEventSchema.parse(specEvent)).toEqual(specEvent)
  })

  it('allows a system action with no actor and no request id', () => {
    const parsed = AuditEventSchema.parse({ ...specEvent, actorUserId: null, requestId: null })
    expect(parsed.actorUserId).toBeNull()
    expect(parsed.requestId).toBeNull()
  })

  it.each([
    'user.created',
    'user.updated',
    'link.created',
    'link.updated',
    'link.deleted',
    'link.transferred',
    'transfer.created',
    'organization.settings_updated',
  ])('accepts the event type %s from spec 07', (type) => {
    expect(AuditEventTypeSchema.parse(type)).toBe(type)
  })

  it('rejects an unknown event type', () => {
    expect(AuditEventSchema.safeParse({ ...specEvent, type: 'link.viewed' }).success).toBe(false)
  })

  it('rejects an unknown object type', () => {
    expect(AuditEventSchema.safeParse({ ...specEvent, objectType: 'visit' }).success).toBe(false)
  })

  it('keeps the data payload open', () => {
    expect(AuditEventSchema.parse({ ...specEvent, data: {} }).data).toEqual({})
  })
})

describe('AdminEventsQuerySchema', () => {
  it('defaults the page size', () => {
    expect(AdminEventsQuerySchema.parse({})).toEqual({ limit: 50 })
  })

  it('reads every documented parameter', () => {
    expect(
      AdminEventsQuerySchema.parse({
        type: 'link.created',
        linkId: '42',
        userId: '7',
        limit: '100',
        cursor: 'eyJ2IjoxfQ',
      }),
    ).toEqual({
      type: 'link.created',
      linkId: '42',
      userId: '7',
      limit: 100,
      cursor: 'eyJ2IjoxfQ',
    })
  })

  it('rejects an unknown parameter', () => {
    expect(AdminEventsQuerySchema.safeParse({ objectType: 'link' }).success).toBe(false)
  })

  it('rejects an unknown type filter', () => {
    expect(AdminEventsQuerySchema.safeParse({ type: 'link.viewed' }).success).toBe(false)
  })
})

describe('AuditEventListResponseSchema', () => {
  it('wraps events in the standard envelope', () => {
    expect(AuditEventListResponseSchema.parse({ items: [specEvent], nextCursor: null })).toEqual({
      items: [specEvent],
      nextCursor: null,
    })
  })
})
