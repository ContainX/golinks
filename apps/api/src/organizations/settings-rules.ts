// What an organization settings write has to satisfy before it may be stored (spec 06 §2-3).
//
// A settings document is more than a bag of preferences. Four of its fields describe the
// keyword space every link of the organization lives in, so moving one of them can leave the
// existing links ambiguous, unreachable, or without a canonical form at all. This module is
// the whole of that judgement, and it is pure: it takes the document as it stands, the
// document the admin sent, and the organization's links, and answers with either the writes
// that make the change safe or the reason it cannot be made.
//
// The rules, in the order a failure is reported:
//
//   1. a namespace that still holds links cannot be removed          -> namespace_in_use
//   2. every canonical keyword is recomputed under the new
//      punctuation rule; a keyword left with no canonical form       -> keyword_invalid
//      and two keywords collapsing into one                          -> keyword_conflict
//   3. a namespace whose name is already the first segment of a
//      multi-segment keyword in the default namespace cannot be
//      added (spec 03 §2.5)                                          -> namespace_conflicts
//   4. prefixFallback resolution asks more of a keyword than the
//      standard mode does, and every existing keyword has to
//      satisfy it already (spec 03 §2.4 and §6.1 item 4)             -> keyword_conflict
//
// Rule 3 is judged on the recomputed keywords rather than the stored ones, because both
// changes can arrive in the same request and the prefix a new namespace would collide with is
// the prefix the change leaves behind.
//
// Changing the default namespace is not a rule but a rewrite: the column stores the namespace
// literally (spec 03 §1), so the plan carries the rename and the caller applies it in the same
// transaction as everything else (spec 06 §3).

import {
  canonicalizeKeyword,
  canonicalizeKeywordSegment,
  checkPlaceholderPositions,
  countPlaceholderSegments,
  type EvaluatedKeyword,
  joinKeywordSegments,
  type KeywordRules,
} from '@golinks/shared/keywords'
import type { OrganizationSettings } from '@golinks/shared/settings'
import type { LinkRow } from '../db/schema/index.ts'
import { ApiError } from '../errors.ts'
import { type KeywordColumns, keywordColumns, linkFullPath } from '../links/index.ts'

/** The columns of a link the settings rules read. Nothing here needs the whole row. */
export type SettingsLink = Pick<
  LinkRow,
  | 'id'
  | 'namespace'
  | 'keyword'
  | 'displayKeyword'
  | 'keywordPrefix'
  | 'segmentCount'
  | 'placeholderCount'
>

/** A link as an error names it, in the vocabulary of spec 05 §2.1. */
export interface SettingsLinkReference {
  id: string
  namespace: string
  /** The display keyword, which is what the admin will recognize. */
  keyword: string
  fullPath: string
}

/** One link as the settings change would leave it. */
export interface ProjectedLink {
  link: SettingsLink
  /** The keyword columns recomputed under the new keyword rules. */
  columns: KeywordColumns
  /** The canonical keyword split into segments. */
  segments: string[]
  /** Whether any recomputed column differs from what is stored. */
  changed: boolean
}

/** A row the plan rewrites, addressed by id. */
export interface KeywordColumnUpdate {
  id: number
  columns: KeywordColumns
}

/** The default namespace moving from one name to another (spec 06 §3). */
export interface NamespaceRewrite {
  from: string
  to: string
}

/** Everything a settings write has to do to the links table, and nothing more. */
export interface SettingsUpdatePlan {
  keywordUpdates: KeywordColumnUpdate[]
  namespaceRewrite: NamespaceRewrite | null
}

/** Why a settings write cannot be made, in the error vocabulary of spec 05 §4. */
export interface SettingsRuleFailure {
  code: 'namespace_in_use' | 'namespace_conflicts' | 'keyword_conflict' | 'keyword_invalid'
  message: string
  details: Record<string, unknown>
}

export type SettingsUpdatePlanResult =
  | { ok: true; plan: SettingsUpdatePlan }
  | { ok: false; failure: SettingsRuleFailure }

export interface PlanSettingsUpdateInput {
  /** The document as it is stored today. */
  before: OrganizationSettings
  /** The document the admin sent, already through the shared schema. */
  after: OrganizationSettings
  /** Every link of the organization, in any order. */
  links: readonly SettingsLink[]
}

/** Which namespaces the change adds and which it takes away. */
export interface NamespaceChanges {
  added: string[]
  removed: string[]
}

/** A namespace that cannot be removed, and how much stands in the way. */
export interface NamespaceUsage {
  namespace: string
  linkCount: number
}

/** A namespace that cannot be added, and the keywords it would make ambiguous. */
export interface NamespaceConflict {
  namespace: string
  links: SettingsLinkReference[]
}

/** Two or more keywords that would end up sharing one canonical form. */
export interface KeywordCollision {
  namespace: string
  /** The canonical keyword they would share. */
  keyword: string
  links: SettingsLinkReference[]
}

/** A link whose display keyword has no canonical form under the new punctuation rule. */
export interface InvalidKeyword extends SettingsLinkReference {
  message: string
}

/** What recomputing every canonical keyword produced. */
export interface KeywordRecomputation {
  projected: ProjectedLink[]
  collisions: KeywordCollision[]
  invalid: InvalidKeyword[]
}

/** A keyword prefixFallback resolution cannot accept, and why. */
export interface PlaceholderViolation extends SettingsLinkReference {
  message: string
}

/** A plain keyword and a programmatic one that prefixFallback cannot tell apart. */
export interface PrefixFallbackConflict {
  namespace: string
  prefix: string
  links: SettingsLinkReference[]
}

export interface PrefixFallbackViolations {
  placeholders: PlaceholderViolation[]
  prefixConflicts: PrefixFallbackConflict[]
}

/** Separates the two halves of a grouping key; neither half can contain a space. */
const GROUP_SEPARATOR = ' '

/** How a link is named in an error. */
export function settingsLinkReference(link: SettingsLink): SettingsLinkReference {
  return {
    id: String(link.id),
    namespace: link.namespace,
    keyword: link.displayKeyword,
    fullPath: linkFullPath(link),
  }
}

/**
 * Whether the change reaches the links table at all.
 *
 * Only these four fields describe the keyword space; branding, banners, and the rest are read
 * by the web app and touch nothing. A change that leaves all four alone needs no links loaded
 * and no advisory lock.
 */
export function settingsChangeTouchesLinks(
  before: OrganizationSettings,
  after: OrganizationSettings,
): boolean {
  return (
    before.defaultNamespace !== after.defaultNamespace ||
    before.namespaces.join(GROUP_SEPARATOR) !== after.namespaces.join(GROUP_SEPARATOR) ||
    before.keywords.punctuationSensitive !== after.keywords.punctuationSensitive ||
    before.keywords.resolutionMode !== after.keywords.resolutionMode
  )
}

/** The namespaces the change adds and removes, in the order the documents list them. */
export function namespaceChanges(
  before: OrganizationSettings,
  after: OrganizationSettings,
): NamespaceChanges {
  const kept = new Set(after.namespaces)
  const had = new Set(before.namespaces)
  return {
    added: after.namespaces.filter((namespace) => !had.has(namespace)),
    removed: before.namespaces.filter((namespace) => !kept.has(namespace)),
  }
}

/**
 * Rule 1 (spec 06 §2): a namespace still holding links cannot be removed, and the answer says
 * how many stand in the way so that an admin knows the size of the move ahead of them.
 *
 * A namespace promoted to the default namespace counts as removed too, since the schema keeps
 * the two lists disjoint; requiring it to be empty first is what stops the links arriving from
 * the old default from colliding with the ones already there.
 */
export function findNamespacesInUse(
  removed: readonly string[],
  links: readonly SettingsLink[],
): NamespaceUsage[] {
  const usage: NamespaceUsage[] = []
  for (const namespace of removed) {
    const linkCount = links.filter((link) => link.namespace === namespace).length
    if (linkCount > 0) usage.push({ namespace, linkCount })
  }
  return usage
}

/**
 * Recomputes the canonical keyword of every link from its display keyword under the keyword
 * rules the change leaves in place (spec 06 §2, spec 03 §2.2).
 *
 * Recomputing unconditionally is what makes both directions of the punctuation toggle one
 * piece of code: turning the rule off drops punctuation from each segment, turning it back on
 * restores the display keyword, and leaving it alone reproduces exactly what is stored. The
 * allowed pattern is deliberately not applied, because pattern changes reach new and renamed
 * keywords only (spec 06 §2).
 */
export function recomputeCanonicalKeywords(
  links: readonly SettingsLink[],
  rules: KeywordRules,
): KeywordRecomputation {
  const projected: ProjectedLink[] = []
  const invalid: InvalidKeyword[] = []
  const byCanonicalKeyword = new Map<string, ProjectedLink[]>()

  for (const link of links) {
    const canonical = canonicalizeKeyword(link.displayKeyword, rules)
    if (!canonical.ok) {
      invalid.push({ ...settingsLinkReference(link), message: canonical.message })
      continue
    }

    const columns = keywordColumns(evaluationOf(link.displayKeyword, canonical.segments))
    const entry: ProjectedLink = {
      link,
      columns,
      segments: canonical.segments,
      changed:
        columns.keyword !== link.keyword ||
        columns.keywordPrefix !== link.keywordPrefix ||
        columns.segmentCount !== link.segmentCount ||
        columns.placeholderCount !== link.placeholderCount,
    }
    projected.push(entry)

    // Uniqueness is per organization and namespace (spec 03 §1), so two namespaces may hold
    // the same canonical keyword without either standing in the other's way.
    const key = `${link.namespace}${GROUP_SEPARATOR}${columns.keyword}`
    const group = byCanonicalKeyword.get(key)
    if (group === undefined) byCanonicalKeyword.set(key, [entry])
    else group.push(entry)
  }

  const collisions: KeywordCollision[] = []
  for (const group of byCanonicalKeyword.values()) {
    const first = group[0]
    if (group.length < 2 || first === undefined) continue
    collisions.push({
      namespace: first.link.namespace,
      keyword: first.columns.keyword,
      links: group.map((entry) => settingsLinkReference(entry.link)),
    })
  }

  return { projected, collisions, invalid }
}

/**
 * Rule 3 (spec 03 §2.5): a namespace whose name is already the first segment of a
 * multi-segment keyword in the default namespace would make that keyword ambiguous, because
 * `go/eng/deploy` could then mean either the keyword `eng/deploy` in `go` or the keyword
 * `deploy` in `eng`.
 *
 * A single-segment keyword named after the namespace is fine: a request for `/eng` has no
 * remainder, so it can only mean the default-namespace keyword (spec 04 §4).
 */
export function findNamespaceConflicts(
  added: readonly string[],
  projected: readonly ProjectedLink[],
  defaultNamespace: string,
  rules: KeywordRules,
): NamespaceConflict[] {
  const conflicts: NamespaceConflict[] = []
  for (const namespace of added) {
    // Both sides are compared canonically, the way the resolver detects a namespace.
    const prefix = canonicalizeKeywordSegment(namespace, rules)
    const links = projected
      .filter(
        (entry) =>
          entry.link.namespace === defaultNamespace &&
          entry.columns.segmentCount >= 2 &&
          entry.columns.keywordPrefix === prefix,
      )
      .map((entry) => settingsLinkReference(entry.link))
    if (links.length > 0) conflicts.push({ namespace, links })
  }
  return conflicts
}

/**
 * Whether the change has to hold every existing keyword to the prefixFallback rules.
 *
 * Switching the mode on is the case spec 06 §2 names. A punctuation toggle inside the mode is
 * checked as well, because recomputed keywords can newly collide; every other change is left
 * alone, so an unrelated edit is never blocked by keywords the mode already accepted.
 */
export function revalidatesPrefixFallback(
  before: OrganizationSettings,
  after: OrganizationSettings,
): boolean {
  if (after.keywords.resolutionMode !== 'prefixFallback') return false
  return (
    before.keywords.resolutionMode !== 'prefixFallback' ||
    before.keywords.punctuationSensitive !== after.keywords.punctuationSensitive
  )
}

/**
 * Rule 4: what prefixFallback resolution cannot live with (spec 06 §2).
 *
 * The placeholder rule of spec 03 §2.4 leaves a keyword's second segment either a placeholder
 * or absent, so hierarchical keywords have to go first. The prefix conflict of spec 03 §6.1
 * item 4 is the mode reading `/example` as `example/%s` and `/example/anything` as `example`,
 * which leaves no room for both keywords to exist.
 */
export function findPrefixFallbackViolations(
  projected: readonly ProjectedLink[],
  rules: KeywordRules,
): PrefixFallbackViolations {
  const placeholders: PlaceholderViolation[] = []
  const byPrefix = new Map<string, ProjectedLink[]>()

  for (const entry of projected) {
    const check = checkPlaceholderPositions(entry.segments, rules)
    if (!check.ok) {
      placeholders.push({ ...settingsLinkReference(entry.link), message: check.message })
    }

    const key = `${entry.link.namespace}${GROUP_SEPARATOR}${entry.columns.keywordPrefix}`
    const group = byPrefix.get(key)
    if (group === undefined) byPrefix.set(key, [entry])
    else group.push(entry)
  }

  const prefixConflicts: PrefixFallbackConflict[] = []
  for (const group of byPrefix.values()) {
    const plain = group.filter((entry) => entry.columns.segmentCount === 1)
    const programmatic = group.filter((entry) => entry.columns.placeholderCount > 0)
    const first = plain[0]
    if (plain.length === 0 || programmatic.length === 0 || first === undefined) continue
    prefixConflicts.push({
      namespace: first.link.namespace,
      prefix: first.columns.keywordPrefix,
      links: [...plain, ...programmatic].map((entry) => settingsLinkReference(entry.link)),
    })
  }

  return { placeholders, prefixConflicts }
}

/**
 * Judges a settings change against the organization's links and, when it holds, says what the
 * links table has to be told (spec 06 §2-3).
 *
 * `links` may be empty when `settingsChangeTouchesLinks` said the change stays clear of the
 * keyword space; every rule here is gated on the field that would have loaded them.
 */
export function planSettingsUpdate(input: PlanSettingsUpdateInput): SettingsUpdatePlanResult {
  const { before, after, links } = input
  const rules = after.keywords
  const changes = namespaceChanges(before, after)

  const inUse = findNamespacesInUse(changes.removed, links)
  if (inUse.length > 0) return { ok: false, failure: namespaceInUseFailure(inUse) }

  const recomputed = recomputeCanonicalKeywords(links, rules)
  if (recomputed.invalid.length > 0) {
    return { ok: false, failure: keywordInvalidFailure(recomputed.invalid) }
  }
  if (recomputed.collisions.length > 0) {
    return { ok: false, failure: keywordCollisionFailure(recomputed.collisions) }
  }

  // The links have not moved yet, so the default namespace they sit in is still the old one.
  const conflicts = findNamespaceConflicts(
    changes.added,
    recomputed.projected,
    before.defaultNamespace,
    rules,
  )
  if (conflicts.length > 0) return { ok: false, failure: namespaceConflictsFailure(conflicts) }

  if (revalidatesPrefixFallback(before, after)) {
    const violations = findPrefixFallbackViolations(recomputed.projected, rules)
    if (violations.placeholders.length > 0 || violations.prefixConflicts.length > 0) {
      return { ok: false, failure: prefixFallbackFailure(violations) }
    }
  }

  return {
    ok: true,
    plan: {
      keywordUpdates: recomputed.projected
        .filter((entry) => entry.changed)
        .map((entry) => ({ id: entry.link.id, columns: entry.columns })),
      namespaceRewrite:
        before.defaultNamespace === after.defaultNamespace
          ? null
          : { from: before.defaultNamespace, to: after.defaultNamespace },
    },
  }
}

/** Turns a rule failure into the response of spec 05 §4. */
export function settingsRuleError(failure: SettingsRuleFailure): ApiError {
  return new ApiError(failure.code, failure.message, { details: failure.details })
}

/** The canonical form of a display keyword, in the shape `keywordColumns` reads. */
function evaluationOf(displayKeyword: string, segments: string[]): EvaluatedKeyword {
  const placeholderCount = countPlaceholderSegments(segments)
  return {
    ok: true,
    displayKeyword,
    canonicalKeyword: joinKeywordSegments(segments),
    prefix: segments[0] ?? '',
    segments,
    segmentCount: segments.length,
    placeholderCount,
    isProgrammatic: placeholderCount > 0,
  }
}

function quoted(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(', ')
}

function namespaceInUseFailure(namespaces: readonly NamespaceUsage[]): SettingsRuleFailure {
  const named = namespaces
    .map((usage) => `"${usage.namespace}" holds ${usage.linkCount}`)
    .join(', ')
  return {
    code: 'namespace_in_use',
    message: `A namespace can only be removed once it is empty: ${named}. Move or delete those links first.`,
    details: { namespaces: namespaces.map((usage) => ({ ...usage })) },
  }
}

function namespaceConflictsFailure(conflicts: readonly NamespaceConflict[]): SettingsRuleFailure {
  const named = quoted(conflicts.map((conflict) => conflict.namespace))
  const total = conflicts.reduce((sum, conflict) => sum + conflict.links.length, 0)
  const keywords = total === 1 ? 'keyword' : 'keywords'
  return {
    code: 'namespace_conflicts',
    message: `Adding ${named} would make ${total} existing ${keywords} ambiguous: the name is already the first segment of a keyword in the default namespace.`,
    details: { conflicts: conflicts.map((conflict) => ({ ...conflict })) },
  }
}

function keywordCollisionFailure(collisions: readonly KeywordCollision[]): SettingsRuleFailure {
  const first = collisions[0]
  const named = first === undefined ? '' : quoted(first.links.map((link) => link.fullPath))
  return {
    code: 'keyword_conflict',
    message: `Dropping punctuation from keywords would leave ${named} sharing the canonical keyword "${first?.keyword ?? ''}".`,
    details: { collisions: collisions.map((collision) => ({ ...collision })) },
  }
}

function keywordInvalidFailure(invalid: readonly InvalidKeyword[]): SettingsRuleFailure {
  const named = quoted(invalid.map((link) => link.fullPath))
  return {
    code: 'keyword_invalid',
    message: `Dropping punctuation from keywords would leave ${named} without a canonical form. Rename or delete those links first.`,
    details: { links: invalid.map((link) => ({ ...link })) },
  }
}

function prefixFallbackFailure(violations: PrefixFallbackViolations): SettingsRuleFailure {
  const offending = [
    ...violations.placeholders.map((link) => link.fullPath),
    ...violations.prefixConflicts.flatMap((conflict) => conflict.links.map((l) => l.fullPath)),
  ]
  const details: Record<string, unknown> = {}
  if (violations.placeholders.length > 0) {
    details.placeholderViolations = violations.placeholders.map((link) => ({ ...link }))
  }
  if (violations.prefixConflicts.length > 0) {
    details.prefixConflicts = violations.prefixConflicts.map((conflict) => ({ ...conflict }))
  }
  const exist = offending.length === 1 ? 'exists' : 'exist'
  return {
    code: 'keyword_conflict',
    message: `Prefix fallback resolution cannot be turned on while ${quoted(offending)} ${exist}.`,
    details,
  }
}
