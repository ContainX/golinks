/**
 * What every link screen needs to know about the organization it is in.
 *
 * The directory, the create bar, and the drawer all ask the same questions —
 * which namespaces exist, what a keyword is allowed to look like, what host
 * members type, who is signed in — and all of the answers arrive on `/me`
 * (spec 05 §2.2). Reading them through one hook keeps the screens free of
 * `data?.organization?.` chains and gives them usable defaults while the
 * request is still in flight.
 */

import type { Me, UserRole } from '@golinks/shared/api'
import { DEFAULT_KEYWORD_RULES } from '@golinks/shared/keywords'
import type { KeywordRules, LinkEditMode } from '@golinks/shared/settings'
import { DEFAULT_NAMESPACE } from '@golinks/shared/settings'
import { useMemo } from 'react'
import { useMe } from '../../queries/me.ts'

export interface OrganizationContext {
  /** True once `/me` has answered; false while the defaults below stand in. */
  isLoaded: boolean
  /** The namespace a keyword belongs to when none is named (spec 06 §2). */
  defaultNamespace: string
  /** Every namespace a link may be created in, default first (spec 03 §2.5). */
  namespaces: string[]
  /** The organization's namespaces other than the default. */
  extraNamespaces: string[]
  /** The keyword rules to check typing against (spec 03 §2). */
  keywordRules: KeywordRules
  /** Hostname members type before the keyword, for example `go`. */
  shortHost: string
  /** Canonical origin of this deployment, which always resolves keywords. */
  baseUrl: string
  /** Id of the signed-in member, or `null` before `/me` answers. */
  userId: string | null
  userEmail: string | null
  role: UserRole | null
  isAdmin: boolean
  /** Who may change a destination they do not own (spec 03 §5). */
  editMode: LinkEditMode
  /** No member but an admin may create, edit, delete, or transfer (spec 06). */
  readOnly: boolean
}

const LOADING_CONTEXT: OrganizationContext = {
  isLoaded: false,
  defaultNamespace: DEFAULT_NAMESPACE,
  namespaces: [DEFAULT_NAMESPACE],
  extraNamespaces: [],
  keywordRules: DEFAULT_KEYWORD_RULES,
  shortHost: DEFAULT_NAMESPACE,
  baseUrl: '',
  userId: null,
  userEmail: null,
  role: null,
  isAdmin: false,
  editMode: 'ownersAndAdmins',
  readOnly: false,
}

/** Reads {@link OrganizationContext} out of a `Me` payload. */
export function organizationContext(me: Me): OrganizationContext {
  const { organization, user, app } = me
  const extraNamespaces = organization.namespaces.filter(
    (namespace) => namespace !== organization.defaultNamespace,
  )

  return {
    isLoaded: true,
    defaultNamespace: organization.defaultNamespace,
    namespaces: [organization.defaultNamespace, ...extraNamespaces],
    extraNamespaces,
    keywordRules: organization.keywords,
    shortHost: app.shortHost,
    baseUrl: app.baseUrl,
    userId: user.id,
    userEmail: user.email,
    role: user.role,
    isAdmin: user.role === 'admin',
    editMode: organization.editMode,
    readOnly: organization.readOnly,
  }
}

/**
 * The organization as the current session sees it.
 *
 * Before `/me` answers — and for a member on their way to sign-in — the stock
 * defaults stand in and `isLoaded` is false, so a screen renders its frame
 * rather than an error about a namespace.
 */
export function useOrganizationContext(): OrganizationContext {
  const { data } = useMe()
  return useMemo(() => (data ? organizationContext(data) : LOADING_CONTEXT), [data])
}
