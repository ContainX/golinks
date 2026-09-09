// Storing an organization settings document (spec 06 §2-4).
//
// The rules themselves are pure and live in `organizations/settings-rules.ts`; this is the one
// piece that touches the database. Everything a settings change does — the keyword columns it
// recomputes, the namespace it renames, the document it stores, and the audit row it leaves —
// happens in a single transaction, because a document that no longer describes the links it
// governs is worse than a rejected write: the links would stop resolving.
//
// The transaction takes the organization's settings advisory lock first, so two admins saving
// at once are serialized and each judges its change against what the other actually stored
// rather than against a cached copy.
//
// What no lock here can cover is a link created on another replica in the moment a punctuation
// toggle commits: that request validated its keyword against the settings it had, and spec 06
// §4 already allows those to be up to thirty seconds old. The link is stored in the old
// canonical form and a later toggle brings it into line; nothing is lost, and the unique index
// holds either way.

import {
  DEFAULT_ORGANIZATION_SETTINGS,
  type OrganizationSettings,
  parseOrganizationSettings,
} from '@golinks/shared/settings'
import { and, eq } from 'drizzle-orm'
import type { DatabaseExecutor } from '../audit/index.ts'
import { organizationSettingsUpdatedEvent, recordAuditEvents } from '../audit/index.ts'
import type { Database } from '../db/client.ts'
import { links, organizations } from '../db/schema/index.ts'
import { validationFailed } from '../errors.ts'
import { withKeywordLock } from '../links/index.ts'
import {
  planSettingsUpdate,
  type SettingsLink,
  type SettingsUpdatePlan,
  settingsChangeTouchesLinks,
  settingsRuleError,
} from '../organizations/settings-rules.ts'
import type { OrganizationSettingsService } from '../organizations/settings-service.ts'

/**
 * The lock a settings write holds.
 *
 * `withKeywordLock` keys on `(organization, namespace, prefix)`, and a link write always has a
 * namespace and a first segment to put there (spec 03 §6.1). The empty pair is therefore a key
 * only a settings write can produce, which is exactly the mutual exclusion wanted here: two
 * settings writes queue behind each other, and a link write on some prefix is never made to
 * wait for an admin editing the banner.
 */
const SETTINGS_LOCK_PART = ''

/** The columns the rules read, and nothing more, for every link of the organization. */
const SETTINGS_LINK_COLUMNS = {
  id: links.id,
  namespace: links.namespace,
  keyword: links.keyword,
  displayKeyword: links.displayKeyword,
  keywordPrefix: links.keywordPrefix,
  segmentCount: links.segmentCount,
  placeholderCount: links.placeholderCount,
}

export interface UpdateOrganizationSettingsInput {
  db: Database
  /** The cached service, whose copy is dropped once the change is committed (spec 06 §4). */
  settings: OrganizationSettingsService
  organizationId: string
  /** The document the admin sent, already through the shared schema. */
  document: OrganizationSettings
  /** The admin behind the change, for the audit trail (spec 07 §1). */
  actorUserId: number | null
  requestId?: string | null
}

/** The stored document, or the defaults when the organization has no row or an unusable one. */
export async function readStoredSettings(
  tx: DatabaseExecutor,
  organizationId: string,
): Promise<OrganizationSettings> {
  const rows = await tx
    .select({ settings: organizations.settings })
    .from(organizations)
    .where(eq(organizations.id, organizationId))
    .limit(1)

  const row = rows[0]
  if (row === undefined) return DEFAULT_ORGANIZATION_SETTINGS
  const parsed = parseOrganizationSettings(row.settings)
  // A stored document that no longer validates reads as the defaults everywhere else too, so
  // the change an admin is making is judged against the same thing the resolver sees.
  return parsed.ok ? parsed.settings : DEFAULT_ORGANIZATION_SETTINGS
}

/**
 * Applies a settings change: the rules of spec 06 §2-3 first, then the writes they allow.
 *
 * Throws the `ApiError` of spec 05 §4 when a rule refuses the change, in which case nothing has
 * been written. Returns the stored document otherwise.
 */
export async function updateOrganizationSettings(
  input: UpdateOrganizationSettingsInput,
): Promise<OrganizationSettings> {
  const { db, organizationId, document, actorUserId } = input
  const requestId = input.requestId ?? null

  // Spec 06 §6: a value the deployment fixes is refused here, before the lock is taken and
  // before anything is read, and reported field by field like any other rejected document.
  const managed = input.settings.managedViolations(document)
  if (Object.keys(managed).length > 0) throw validationFailed(managed)

  const after = await withKeywordLock(
    db,
    { organizationId, namespace: SETTINGS_LOCK_PART, prefix: SETTINGS_LOCK_PART },
    async (tx) => {
      const before = await readStoredSettings(tx, organizationId)

      // Only the four fields that describe the keyword space need the links; every other field
      // is read by the web app alone, and loading a whole organization for a banner edit would
      // be work for nothing.
      const organizationLinks = settingsChangeTouchesLinks(before, document)
        ? await loadOrganizationLinks(tx, organizationId)
        : []

      const planned = planSettingsUpdate({ before, after: document, links: organizationLinks })
      if (!planned.ok) throw settingsRuleError(planned.failure)

      await applyPlan(tx, organizationId, planned.plan)

      await tx
        .insert(organizations)
        .values({ id: organizationId, settings: document })
        .onConflictDoUpdate({
          target: organizations.id,
          set: { settings: document, updatedAt: new Date() },
        })

      await recordAuditEvents(tx, { organizationId, actorUserId, requestId }, [
        organizationSettingsUpdatedEvent(organizationId, before, document),
      ])

      return document
    },
  )

  // Spec 06 §4: the replica that wrote sees the change at once, every other one within the
  // cache lifetime.
  input.settings.invalidate(organizationId)
  return after
}

/** Every link of the organization, in the shape the rules read. */
export async function loadOrganizationLinks(
  tx: DatabaseExecutor,
  organizationId: string,
): Promise<SettingsLink[]> {
  return await tx
    .select(SETTINGS_LINK_COLUMNS)
    .from(links)
    .where(eq(links.organizationId, organizationId))
}

/**
 * Carries out what the rules allowed: the recomputed keyword columns first, then the rename of
 * the default namespace (spec 06 §3).
 *
 * The order matters. The columns are computed while the links still sit where they are, and
 * the rename only moves rows between namespaces the rules have already proven empty, so no
 * intermediate state can trip the unique index of spec 03 §1.
 */
async function applyPlan(
  tx: DatabaseExecutor,
  organizationId: string,
  plan: SettingsUpdatePlan,
): Promise<void> {
  for (const update of plan.keywordUpdates) {
    await tx
      .update(links)
      .set({ ...update.columns, updatedAt: new Date() })
      .where(and(eq(links.organizationId, organizationId), eq(links.id, update.id)))
  }

  if (plan.namespaceRewrite === null) return
  await tx
    .update(links)
    .set({ namespace: plan.namespaceRewrite.to, updatedAt: new Date() })
    .where(
      and(
        eq(links.organizationId, organizationId),
        eq(links.namespace, plan.namespaceRewrite.from),
      ),
    )
}
