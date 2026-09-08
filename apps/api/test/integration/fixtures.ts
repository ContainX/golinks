// Rows the integration suites build on.
//
// Two organizations, widgets.test and gizmos.test, appear throughout so that every suite
// can prove isolation (spec 10 section 2).

import { DEFAULT_ORGANIZATION_SETTINGS } from '@golinks/shared/settings'
import type { Database } from '../../src/db/client.ts'
import type { LinkRow, OrganizationRow, UserRow } from '../../src/db/schema/index.ts'
import { links, organizations, users } from '../../src/db/schema/index.ts'

export const TEST_ORGANIZATION_IDS = {
  widgets: 'widgets.test',
  gizmos: 'gizmos.test',
} as const

function first<Row>(rows: Row[], what: string): Row {
  const row = rows[0]
  if (row === undefined) throw new Error(`Inserting a ${what} returned no row.`)
  return row
}

export async function insertOrganization(db: Database, id: string): Promise<OrganizationRow> {
  const rows = await db
    .insert(organizations)
    .values({ id, settings: DEFAULT_ORGANIZATION_SETTINGS })
    .returning()
  return first(rows, 'organization')
}

export interface UserFixture {
  email: string
  organizationId: string
  role?: 'member' | 'admin'
  isEnabled?: boolean
}

export async function insertUser(db: Database, fixture: UserFixture): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({
      email: fixture.email,
      organizationId: fixture.organizationId,
      role: fixture.role ?? 'member',
      isEnabled: fixture.isEnabled ?? true,
    })
    .returning()
  return first(rows, 'user')
}

export interface LinkFixture {
  organizationId: string
  ownerId: number
  keyword: string
  namespace?: string
  displayKeyword?: string
  destination?: string
  isUnlisted?: boolean
  createdById?: number
}

/**
 * Derives the denormalized keyword columns the way the link service will.
 *
 * Deliberately literal: normalization and canonicalization are the product rules of spec 03
 * section 2 and get their own unit tests. Fixtures take keywords already in canonical form.
 */
export async function insertLink(db: Database, fixture: LinkFixture): Promise<LinkRow> {
  const segments = fixture.keyword.split('/')
  const prefix = segments[0]
  if (prefix === undefined) throw new Error('A keyword needs at least one segment.')

  const rows = await db
    .insert(links)
    .values({
      organizationId: fixture.organizationId,
      namespace: fixture.namespace ?? 'go',
      keyword: fixture.keyword,
      displayKeyword: fixture.displayKeyword ?? fixture.keyword,
      keywordPrefix: prefix,
      segmentCount: segments.length,
      placeholderCount: segments.filter((segment) => segment === '%s').length,
      destination: fixture.destination ?? 'https://example.test/',
      ownerId: fixture.ownerId,
      createdById: fixture.createdById ?? fixture.ownerId,
      isUnlisted: fixture.isUnlisted ?? false,
    })
    .returning()
  return first(rows, 'link')
}
