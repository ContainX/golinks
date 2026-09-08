// Ownership transfer links end to end (spec 05 §3, spec 03 §9.2).
//
// One link, one token, three endpoints: the owner mints a URL, a colleague looks at what it
// offers, and accepting it moves the link. Every refusal in the chain of spec 03 §9.2 has a
// code, and each of them is reached here through HTTP.

import { createHash } from 'node:crypto'
import {
  API_BASE_PATH,
  LinkSchema,
  type Transfer,
  TransferPreviewSchema,
  TransferSchema,
} from '@golinks/shared/api'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type LinkRow, links, linkTransfers, users } from '../../src/db/schema/index.ts'
import { TRANSFER_PATH_PREFIX } from '../../src/links/index.ts'
import type { GoLinksApp } from '../../src/types.ts'
import { insertLink, insertOrganization, insertUser, TEST_ORGANIZATION_IDS } from './fixtures.ts'
import { resetDatabase, useTestDatabase } from './harness.ts'
import {
  applySettings,
  buildLinksApp,
  errorCodeOf,
  readAuditEvents,
  type SignedInMember,
  signInMember,
} from './links-fixtures.ts'

const database = useTestDatabase()
const LINKS_URL = `${API_BASE_PATH}/links`
const TRANSFERS_URL = `${API_BASE_PATH}/transfers`
const WIDGETS = TEST_ORGANIZATION_IDS.widgets
const GIZMOS = TEST_ORGANIZATION_IDS.gizmos

let app: GoLinksApp
let ada: SignedInMember
let grace: SignedInMember
let linus: SignedInMember
let link: LinkRow

beforeEach(async () => {
  await resetDatabase()
  app = await buildLinksApp(database().db)
  ada = await signInMember(app, database().db, { email: `ada@${WIDGETS}` })
  grace = await signInMember(app, database().db, { email: `grace@${WIDGETS}`, admin: true })
  linus = await signInMember(app, database().db, { email: `linus@${WIDGETS}` })
  link = await insertLink(database().db, {
    organizationId: WIDGETS,
    ownerId: ada.user.id,
    keyword: 'handbook',
    destination: 'https://wiki.widgets.test/handbook',
  })
})

afterEach(async () => {
  await app.close()
})

function createTransfer(who: SignedInMember, id: number | string = link.id) {
  return app.inject({
    method: 'POST',
    url: `${LINKS_URL}/${id}/transfers`,
    headers: { cookie: who.session.cookie, origin: app.appConfig.baseUrl },
  })
}

/** The token out of the URL a creation answered with; the only place it ever appears. */
function tokenOf(transfer: Transfer): string {
  const prefix = `${app.appConfig.baseUrl}${TRANSFER_PATH_PREFIX}/`
  expect(transfer.url.startsWith(prefix)).toBe(true)
  return transfer.url.slice(prefix.length)
}

async function mintToken(who: SignedInMember = ada): Promise<string> {
  const response = await createTransfer(who)
  expect(response.statusCode).toBe(201)
  return tokenOf(TransferSchema.parse(response.json()))
}

function preview(who: SignedInMember, token: string) {
  return app.inject({
    method: 'GET',
    url: `${TRANSFERS_URL}/${encodeURIComponent(token)}`,
    headers: who.headers,
  })
}

function accept(who: SignedInMember, token: string) {
  return app.inject({
    method: 'POST',
    url: `${TRANSFERS_URL}/${encodeURIComponent(token)}/accept`,
    headers: { cookie: who.session.cookie, origin: app.appConfig.baseUrl },
  })
}

describe('creating a transfer link (spec 03 §9.2)', () => {
  it('answers 201 with the acceptance URL and when it stops working', async () => {
    const before = Date.now()

    const response = await createTransfer(ada)

    expect(response.statusCode).toBe(201)
    const parsed = TransferSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    const transfer = TransferSchema.parse(response.json())
    expect(transfer.url.startsWith(`${app.appConfig.baseUrl}${TRANSFER_PATH_PREFIX}/`)).toBe(true)
    // 32 random bytes, base64url encoded, is 43 characters with no padding.
    expect(tokenOf(transfer)).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const ttl = Date.parse(transfer.expiresAt) - before
    expect(ttl).toBeGreaterThan(23 * 60 * 60 * 1000)
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000)
  })

  it('stores the hash of the token and never the token', async () => {
    const token = await mintToken(ada)

    const [row] = await database().db.select().from(linkTransfers)
    expect(row?.tokenHash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'))
    expect(JSON.stringify(row)).not.toContain(token)
    expect(row).toMatchObject({
      linkId: link.id,
      createdById: ada.user.id,
      expectedOwnerId: ada.user.id,
      acceptedById: null,
      acceptedAt: null,
      revokedAt: null,
    })
  })

  it('records transfer.created against the transfer', async () => {
    const response = await createTransfer(ada)
    const id = TransferSchema.parse(response.json()).id

    const events = await readAuditEvents(database().db, WIDGETS, { type: 'transfer', id })
    expect(events.map((event) => event.type)).toEqual(['transfer.created'])
    expect(events[0]?.data).toMatchObject({ linkId: String(link.id) })
    expect(events[0]?.actorUserId).toBe(ada.user.id)
  })

  it('lets an admin mint a transfer for someone else’s link', async () => {
    expect((await createTransfer(grace)).statusCode).toBe(201)
  })

  it('refuses another member with forbidden', async () => {
    const response = await createTransfer(linus)

    expect(response.statusCode).toBe(403)
    expect(errorCodeOf(response)).toBe('forbidden')
  })

  it('refuses the owner while the organization is read-only', async () => {
    await applySettings(app, WIDGETS, { readOnly: true })

    const response = await createTransfer(ada)

    expect(response.statusCode).toBe(403)
    expect(errorCodeOf(response)).toBe('read_only')
  })

  it('answers 404 for a link in another organization', async () => {
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await insertUser(db, { email: `zoe@${GIZMOS}`, organizationId: GIZMOS })
    const theirs = await insertLink(db, {
      organizationId: GIZMOS,
      ownerId: stranger.id,
      keyword: 'handbook',
    })

    const response = await createTransfer(grace, theirs.id)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('not_found')
  })

  it('revokes whatever else was pending for the link', async () => {
    const first = await mintToken(ada)
    const second = await mintToken(ada)

    expect(TransferPreviewSchema.parse((await preview(linus, first)).json()).status).toBe('revoked')
    expect(TransferPreviewSchema.parse((await preview(linus, second)).json()).status).toBe(
      'pending',
    )
    const superseded = await accept(linus, first)
    expect(superseded.statusCode).toBe(404)
    expect(errorCodeOf(superseded)).toBe('transfer_invalid')
  })
})

describe('previewing a transfer link', () => {
  it('describes the link the token offers without changing anything', async () => {
    const token = await mintToken(ada)

    const response = await preview(linus, token)

    expect(response.statusCode).toBe(200)
    const parsed = TransferPreviewSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.data).toMatchObject({
      status: 'pending',
      link: {
        id: String(link.id),
        fullPath: 'go/handbook',
        destination: 'https://wiki.widgets.test/handbook',
        owner: { id: String(ada.user.id), email: ada.user.email },
      },
    })
    const [row] = await database().db.select().from(linkTransfers)
    expect(row).toMatchObject({ acceptedAt: null, revokedAt: null })
  })

  it('says expired once the token has run out', async () => {
    const token = await mintToken(ada)
    await database()
      .db.update(linkTransfers)
      .set({ expiresAt: new Date(Date.now() - 1_000) })

    const body = TransferPreviewSchema.parse((await preview(linus, token)).json())
    expect(body.status).toBe('expired')
  })

  it('says accepted once it has been used', async () => {
    const token = await mintToken(ada)
    await accept(linus, token)

    const body = TransferPreviewSchema.parse((await preview(linus, token)).json())
    expect(body.status).toBe('accepted')
  })

  it('says invalid when the link changed hands in the meantime', async () => {
    const token = await mintToken(ada)
    await database().db.update(links).set({ ownerId: grace.user.id }).where(eq(links.id, link.id))

    const body = TransferPreviewSchema.parse((await preview(linus, token)).json())
    expect(body.status).toBe('invalid')
  })

  it('says invalid when whoever minted it can no longer transfer the link', async () => {
    const token = await mintToken(ada)
    await database().db.update(users).set({ isEnabled: false }).where(eq(users.id, ada.user.id))

    const body = TransferPreviewSchema.parse((await preview(linus, token)).json())
    expect(body.status).toBe('invalid')
  })

  it('answers 404 for a token nothing was ever minted under', async () => {
    const response = await preview(linus, 'a'.repeat(43))

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('transfer_invalid')
  })

  it('answers 404, describing nothing, for a token from another organization', async () => {
    const token = await mintToken(ada)
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await signInMember(app, db, { email: `zoe@${GIZMOS}` })

    const response = await preview(stranger, token)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('transfer_invalid')
    expect(response.body).not.toContain('handbook')
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const token = await mintToken(ada)

    const response = await app.inject({ method: 'GET', url: `${TRANSFERS_URL}/${token}` })

    expect(response.statusCode).toBe(401)
    expect(errorCodeOf(response)).toBe('unauthenticated')
  })
})

describe('accepting a transfer link', () => {
  it('moves the link to whoever accepted and answers with it', async () => {
    const token = await mintToken(ada)

    const response = await accept(linus, token)

    expect(response.statusCode).toBe(200)
    const parsed = LinkSchema.safeParse(response.json())
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.data).toMatchObject({
      id: String(link.id),
      owner: { id: String(linus.user.id), email: linus.user.email },
      permissions: { canEdit: true, canDelete: true, canTransfer: true },
    })
    const [row] = await database().db.select().from(links).where(eq(links.id, link.id))
    expect(row?.ownerId).toBe(linus.user.id)
  })

  it('marks the transfer accepted by the member who used it', async () => {
    const token = await mintToken(ada)

    await accept(linus, token)

    const [row] = await database().db.select().from(linkTransfers)
    expect(row?.acceptedById).toBe(linus.user.id)
    expect(row?.acceptedAt).toBeInstanceOf(Date)
  })

  it('records link.transferred with the transferLink method', async () => {
    const token = await mintToken(ada)

    await accept(linus, token)

    const events = await readAuditEvents(database().db, WIDGETS, { type: 'link', id: link.id })
    expect(events.map((event) => event.type)).toEqual(['link.transferred'])
    expect(events[0]?.data).toEqual({
      fromUserId: String(ada.user.id),
      toUserId: String(linus.user.id),
      method: 'transferLink',
    })
    expect(events[0]?.actorUserId).toBe(linus.user.id)
  })

  it('answers transfer_invalid for a token nothing was minted under', async () => {
    const response = await accept(linus, 'a'.repeat(43))

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('transfer_invalid')
  })

  it('answers transfer_expired once the token has run out', async () => {
    const token = await mintToken(ada)
    await database()
      .db.update(linkTransfers)
      .set({ expiresAt: new Date(Date.now() - 1_000) })

    const response = await accept(linus, token)

    expect(response.statusCode).toBe(410)
    expect(errorCodeOf(response)).toBe('transfer_expired')
  })

  it('answers transfer_invalid the second time the same token is used', async () => {
    const token = await mintToken(ada)
    expect((await accept(linus, token)).statusCode).toBe(200)

    const response = await accept(grace, token)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('transfer_invalid')
  })

  it('answers transfer_invalid when the link has since been deleted', async () => {
    const token = await mintToken(ada)
    await database().db.delete(links).where(eq(links.id, link.id))

    const response = await accept(linus, token)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('transfer_invalid')
  })

  it('answers transfer_owner_changed when the link changed hands first', async () => {
    const token = await mintToken(ada)
    await database().db.update(links).set({ ownerId: grace.user.id }).where(eq(links.id, link.id))

    const response = await accept(linus, token)

    expect(response.statusCode).toBe(409)
    expect(errorCodeOf(response)).toBe('transfer_owner_changed')
  })

  it('answers transfer_creator_lost_access when the creator has been disabled', async () => {
    const token = await mintToken(ada)
    await database().db.update(users).set({ isEnabled: false }).where(eq(users.id, ada.user.id))

    const response = await accept(linus, token)

    expect(response.statusCode).toBe(409)
    expect(errorCodeOf(response)).toBe('transfer_creator_lost_access')
  })

  it('answers transfer_creator_lost_access when an admin creator is no longer an admin', async () => {
    const token = await mintToken(grace)
    await database().db.update(users).set({ role: 'member' }).where(eq(users.id, grace.user.id))

    const response = await accept(linus, token)

    expect(response.statusCode).toBe(409)
    expect(errorCodeOf(response)).toBe('transfer_creator_lost_access')
  })

  it('answers transfer_invalid to a member of another organization', async () => {
    const token = await mintToken(ada)
    const { db } = database()
    await insertOrganization(db, GIZMOS)
    const stranger = await signInMember(app, db, { email: `zoe@${GIZMOS}` })

    const response = await accept(stranger, token)

    expect(response.statusCode).toBe(404)
    expect(errorCodeOf(response)).toBe('transfer_invalid')
    const [row] = await db.select().from(links).where(eq(links.id, link.id))
    expect(row?.ownerId).toBe(ada.user.id)
  })

  it('answers transfer_already_owner when the owner follows their own link', async () => {
    const token = await mintToken(ada)

    const response = await accept(ada, token)

    expect(response.statusCode).toBe(409)
    expect(errorCodeOf(response)).toBe('transfer_already_owner')
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const token = await mintToken(ada)

    const response = await app.inject({
      method: 'POST',
      url: `${TRANSFERS_URL}/${token}/accept`,
      headers: { origin: app.appConfig.baseUrl },
    })

    expect(response.statusCode).toBe(401)
    expect(errorCodeOf(response)).toBe('unauthenticated')
  })

  it('refuses acceptance while the organization is read-only, unless the accepter is an admin', async () => {
    // Accepting changes who owns the link, which read-only mode freezes for everyone but
    // admins (spec 03 §5, §9.2 check 9). The token itself stays valid until the freeze lifts.
    const token = await mintToken(ada)
    await applySettings(app, WIDGETS, { readOnly: true })

    const refused = await accept(linus, token)
    expect(refused.statusCode).toBe(403)
    expect(errorCodeOf(refused)).toBe('read_only')

    const accepted = await accept(grace, token)
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json()).toMatchObject({ owner: { id: String(grace.user.id) } })
  })
})

describe('the whole lifecycle', () => {
  it('mints, previews, accepts, and then refuses the same token', async () => {
    const token = await mintToken(ada)

    expect(TransferPreviewSchema.parse((await preview(linus, token)).json()).status).toBe('pending')
    expect((await accept(linus, token)).statusCode).toBe(200)
    expect(TransferPreviewSchema.parse((await preview(linus, token)).json()).status).toBe(
      'accepted',
    )
    expect((await accept(grace, token)).statusCode).toBe(404)

    // The link now belongs to the member who accepted, who may hand it on in their turn.
    expect((await createTransfer(linus)).statusCode).toBe(201)
    expect((await createTransfer(ada)).statusCode).toBe(403)
  })
})
