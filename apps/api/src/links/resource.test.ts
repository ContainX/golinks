import { LinkSchema } from '@golinks/shared/api'
import { describe, expect, it } from 'vitest'
import type { LinkRow } from '../db/schema/index.ts'
import { linkFullPath, toLinkOwner, toLinkResource } from './resource.ts'

const OWNER = { id: 7, email: 'ada@widgets.test' }

function linkRow(overrides: Partial<LinkRow> = {}): LinkRow {
  return {
    id: 42,
    organizationId: 'widgets.test',
    namespace: 'go',
    keyword: 'jira/%s',
    displayKeyword: 'jira/%s',
    keywordPrefix: 'jira',
    segmentCount: 2,
    placeholderCount: 1,
    destination: 'https://widgets.atlassian.net/browse/%s',
    ownerId: OWNER.id,
    isUnlisted: false,
    visitCount: 12,
    lastVisitedAt: new Date('2026-09-01T08:00:00.000Z'),
    createdById: OWNER.id,
    createdAt: new Date('2026-08-01T09:30:00.000Z'),
    updatedAt: new Date('2026-08-02T10:15:00.000Z'),
    ...overrides,
  }
}

const PERMISSIONS = {
  canEditDestination: true,
  canEdit: true,
  canDelete: false,
  canTransfer: false,
}

describe('toLinkResource', () => {
  it('produces a resource the shared schema accepts', () => {
    const resource = toLinkResource(linkRow(), OWNER, PERMISSIONS)
    expect(LinkSchema.parse(resource)).toEqual(resource)
  })

  it('maps every column the resource shows', () => {
    expect(toLinkResource(linkRow(), OWNER, PERMISSIONS)).toEqual({
      id: '42',
      namespace: 'go',
      keyword: 'jira/%s',
      displayKeyword: 'jira/%s',
      fullPath: 'go/jira/%s',
      destination: 'https://widgets.atlassian.net/browse/%s',
      isProgrammatic: true,
      placeholderCount: 1,
      isUnlisted: false,
      owner: { id: '7', email: 'ada@widgets.test' },
      visitCount: 12,
      lastVisitedAt: '2026-09-01T08:00:00.000Z',
      createdAt: '2026-08-01T09:30:00.000Z',
      updatedAt: '2026-08-02T10:15:00.000Z',
      permissions: PERMISSIONS,
    })
  })

  it('calls a link without placeholders plain, and an unvisited link never visited', () => {
    const resource = toLinkResource(
      linkRow({ keyword: 'handbook', placeholderCount: 0, lastVisitedAt: null }),
      OWNER,
      PERMISSIONS,
    )
    expect(resource.isProgrammatic).toBe(false)
    expect(resource.lastVisitedAt).toBeNull()
  })

  it('shows the display keyword, not the canonical one, in the path', () => {
    const resource = toLinkResource(
      linkRow({ keyword: 'meetingnotes', displayKeyword: 'meeting-notes' }),
      OWNER,
      PERMISSIONS,
    )
    expect(resource.keyword).toBe('meetingnotes')
    expect(resource.fullPath).toBe('go/meeting-notes')
  })

  it('carries only the four permission fields the wire shape declares', () => {
    const resource = toLinkResource(linkRow(), OWNER, {
      ...PERMISSIONS,
      canSeeInDirectory: true,
      canSetOwner: true,
    } as never)
    expect(Object.keys(resource.permissions).sort()).toEqual([
      'canDelete',
      'canEdit',
      'canEditDestination',
      'canTransfer',
    ])
  })
})

describe('linkFullPath', () => {
  it('joins the namespace and the display keyword', () => {
    expect(linkFullPath({ namespace: 'eng', displayKeyword: 'deploy' })).toBe('eng/deploy')
  })
})

describe('toLinkOwner', () => {
  it('turns the row id into the string the wire carries', () => {
    expect(toLinkOwner(OWNER)).toEqual({ id: '7', email: 'ada@widgets.test' })
  })
})
