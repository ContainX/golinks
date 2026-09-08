// Every table in the database, in dependency order.
//
// Drizzle reads this barrel through `apps/api/drizzle.config.ts` to generate migrations, and
// the client passes it to `drizzle()` so queries can be written against the table objects.

export type { AuditEventRow, NewAuditEventRow } from './audit-events.ts'

export { auditEvents } from './audit-events.ts'
export { citext, timestamptz } from './columns.ts'
export type { LinkTransferRow, NewLinkTransferRow } from './link-transfers.ts'
export { linkTransfers } from './link-transfers.ts'
export type { LinkVisitRow, LinkVisitSource, NewLinkVisitRow } from './link-visits.ts'
export { LINK_VISIT_SOURCES, linkVisits } from './link-visits.ts'
export type { LinkRow, NewLinkRow } from './links.ts'
export { links } from './links.ts'
export type { NewOrganizationRow, OrganizationRow } from './organizations.ts'
export { organizations } from './organizations.ts'
export type { NewSessionRow, SessionData, SessionRow } from './sessions.ts'
export { sessions } from './sessions.ts'
export type { NewUserRow, UserRow } from './users.ts'
export { users } from './users.ts'

/**
 * Table names in an order that satisfies the foreign keys, oldest dependency first.
 * The integration harness truncates in this order, and it is the order the initial
 * migration creates them in.
 */
export const TABLE_NAMES = [
  'organizations',
  'users',
  'sessions',
  'links',
  'link_transfers',
  'audit_events',
  'link_visits',
] as const

export type TableName = (typeof TABLE_NAMES)[number]
