import { isConsumerEmailDomain } from './consumer-domains.ts'

/** How a deployment turns a verified email address into an organization id. */
export type OrganizationResolutionStrategy = 'domain' | 'fixed'

export interface OrganizationResolutionConfig {
  /**
   * `domain` keys the organization on the address's domain, or on the whole
   * address when the domain belongs to a consumer provider. `fixed` puts every
   * member in one organization.
   */
  strategy: OrganizationResolutionStrategy
  /** The organization id every member joins under the `fixed` strategy. */
  fixedId?: string
  /**
   * Aliases applied after the strategy, keyed by domain or by full address, so
   * that a second domain or one personal address can join an existing
   * organization.
   */
  aliases: Readonly<Record<string, string>>
  /**
   * Optional allowlist. When present and non-empty, a sign-in that resolves to
   * an organization outside it is rejected.
   */
  allowedIds?: readonly string[]
}

export type OrganizationResolutionErrorCode = 'org_not_allowed' | 'org_unresolvable'

export interface ResolvedOrganization {
  ok: true
  organizationId: string
}

export interface OrganizationResolutionFailure {
  ok: false
  code: OrganizationResolutionErrorCode
  message: string
}

export type OrganizationResolutionResult = ResolvedOrganization | OrganizationResolutionFailure

/**
 * Returns the domain part of an email address, lowercased, or null when the
 * value is not shaped like an address. The part after the last `@` wins, since
 * a quoted local part may itself contain one.
 */
export function extractEmailDomain(email: string): string | null {
  const address = email.trim().toLowerCase()
  const at = address.lastIndexOf('@')
  if (at <= 0 || at === address.length - 1) return null
  return address.slice(at + 1)
}

/**
 * Resolves the organization for a sign-in (spec 01 §1.2).
 *
 * The strategy runs first, then aliases, then the allowlist. Aliases are looked
 * up by the full address before the strategy's answer, so an alias can move one
 * personal address into an organization whatever the strategy decided. Aliases
 * are not chained: an alias value is the final id.
 *
 * `org_unresolvable` covers the two ways the inputs cannot produce an id at
 * all: an address with no domain under the `domain` strategy, and a `fixed`
 * strategy with no `fixedId`. Everything else that is rejected is
 * `org_not_allowed`.
 */
export function resolveOrganizationId(
  email: string,
  config: OrganizationResolutionConfig,
): OrganizationResolutionResult {
  const address = email.trim().toLowerCase()

  const fromStrategy = applyStrategy(address, config)
  if (!fromStrategy.ok) return fromStrategy

  const organizationId = applyAliases(address, fromStrategy.organizationId, config.aliases)

  const allowed = normalizeIds(config.allowedIds)
  if (allowed !== null && !allowed.has(organizationId)) {
    return {
      ok: false,
      code: 'org_not_allowed',
      message: `The organization "${organizationId}" is not in this deployment's allowlist.`,
    }
  }

  return { ok: true, organizationId }
}

function applyStrategy(
  address: string,
  config: OrganizationResolutionConfig,
): OrganizationResolutionResult {
  if (config.strategy === 'fixed') {
    const fixedId = config.fixedId?.trim().toLowerCase() ?? ''
    if (fixedId.length === 0) {
      return {
        ok: false,
        code: 'org_unresolvable',
        message:
          'The fixed organization strategy needs an organization id, but none is configured.',
      }
    }
    return { ok: true, organizationId: fixedId }
  }

  const domain = extractEmailDomain(address)
  if (domain === null) {
    return {
      ok: false,
      code: 'org_unresolvable',
      message: `"${address}" has no domain part, so no organization can be derived from it.`,
    }
  }

  return { ok: true, organizationId: isConsumerEmailDomain(domain) ? address : domain }
}

function applyAliases(
  address: string,
  organizationId: string,
  aliases: Readonly<Record<string, string>>,
): string {
  const map = new Map<string, string>()
  for (const [key, value] of Object.entries(aliases)) {
    const normalizedKey = key.trim().toLowerCase()
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedKey.length === 0 || normalizedValue.length === 0) continue
    map.set(normalizedKey, normalizedValue)
  }

  return map.get(address) ?? map.get(organizationId) ?? organizationId
}

function normalizeIds(ids: readonly string[] | undefined): ReadonlySet<string> | null {
  if (ids === undefined) return null
  const normalized = new Set(ids.map((id) => id.trim().toLowerCase()).filter((id) => id.length > 0))
  return normalized.size === 0 ? null : normalized
}
