// The token half of a transfer link (spec 03 §9.2): how one is minted, how it is stored, and
// what the creator copies.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  generateTransferToken,
  hashTransferToken,
  TRANSFER_PATH_PREFIX,
  TRANSFER_TOKEN_BYTES,
  transferUrl,
} from './transfers.ts'

describe('the token', () => {
  it('is 32 random bytes, base64url encoded', () => {
    const token = generateTransferToken()

    expect(TRANSFER_TOKEN_BYTES).toBe(32)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, 'base64url')).toHaveLength(TRANSFER_TOKEN_BYTES)
  })

  it('is different every time', () => {
    const minted = new Set(Array.from({ length: 100 }, () => generateTransferToken()))

    expect(minted.size).toBe(100)
  })

  it('is stored as its SHA-256 and never as itself', () => {
    const token = generateTransferToken()

    const hash = hashTransferToken(token)

    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain(token)
  })

  it('hashes to the same value every time it is looked up', () => {
    const token = generateTransferToken()

    expect(hashTransferToken(token)).toBe(hashTransferToken(token))
    expect(hashTransferToken(token)).not.toBe(hashTransferToken(generateTransferToken()))
  })
})

describe('the acceptance URL', () => {
  it('is the deployment base URL and the token, with nothing in between', () => {
    expect(transferUrl('https://links.example.com', 'abc-123_XYZ')).toBe(
      'https://links.example.com/_/transfer/abc-123_XYZ',
    )
    expect(TRANSFER_PATH_PREFIX).toBe('/_/transfer')
  })

  it('needs no escaping, because base64url has nothing a URL objects to', () => {
    const token = generateTransferToken()
    const url = transferUrl('https://links.example.com', token)

    expect(new URL(url).pathname).toBe(`${TRANSFER_PATH_PREFIX}/${token}`)
  })
})
