import { describe, expect, it } from 'vitest'
import {
  TransferPreviewSchema,
  TransferSchema,
  TransferStatusSchema,
  TransferTokenParamsSchema,
} from './transfers.ts'

/** The examples from spec 05 section 2.4. */
const specTransfer = {
  id: '3',
  url: 'https://links.example.com/_/transfer/Zm9vYmFy',
  expiresAt: '2026-09-08T14:03:00Z',
}

const specPreview = {
  status: 'pending',
  link: {
    id: '42',
    fullPath: 'go/meeting-notes',
    destination: 'https://docs.acme.com/notes',
    owner: { id: '7', email: 'jane@acme.com' },
  },
  expiresAt: '2026-09-08T14:03:00Z',
}

describe('TransferSchema', () => {
  it('parses the resource from the spec', () => {
    expect(TransferSchema.parse(specTransfer)).toEqual(specTransfer)
  })

  it('requires an absolute acceptance url', () => {
    expect(TransferSchema.safeParse({ ...specTransfer, url: '/_/transfer/abc' }).success).toBe(
      false,
    )
  })

  it('requires an ISO expiry', () => {
    expect(TransferSchema.safeParse({ ...specTransfer, expiresAt: 'tomorrow' }).success).toBe(false)
  })
})

describe('TransferPreviewSchema', () => {
  it('parses the preview from the spec', () => {
    expect(TransferPreviewSchema.parse(specPreview)).toEqual(specPreview)
  })

  it.each(['pending', 'expired', 'accepted', 'revoked', 'invalid'])(
    'accepts the status %s',
    (status) => {
      expect(TransferPreviewSchema.parse({ ...specPreview, status }).status).toBe(status)
    },
  )

  it('rejects an unknown status', () => {
    expect(TransferStatusSchema.safeParse('cancelled').success).toBe(false)
    expect(TransferPreviewSchema.safeParse({ ...specPreview, status: 'cancelled' }).success).toBe(
      false,
    )
  })

  it('requires the link summary', () => {
    const { link: _link, ...withoutLink } = specPreview
    expect(TransferPreviewSchema.safeParse(withoutLink).success).toBe(false)
  })
})

describe('TransferTokenParamsSchema', () => {
  it('takes the token from the path', () => {
    expect(TransferTokenParamsSchema.parse({ token: 'Zm9vYmFy' })).toEqual({ token: 'Zm9vYmFy' })
  })

  it('rejects an empty token', () => {
    expect(TransferTokenParamsSchema.safeParse({ token: '' }).success).toBe(false)
  })

  it('rejects extra path members', () => {
    expect(TransferTokenParamsSchema.safeParse({ token: 'Zm9v', id: '42' }).success).toBe(false)
  })
})
