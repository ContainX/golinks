/**
 * The state behind every way of creating a link (spec 08 §4).
 *
 * Three screens create links — the bar above the directory, the dialog behind
 * the mobile action button, and the unknown-keyword screen a resolver miss
 * lands on — and they differ only in layout. The rules they share live here:
 * what has been typed, what the organization's keyword rules make of it, what
 * the API said when it refused, and what a `%s` would expand to.
 */

import type { Link } from '@golinks/shared/api'
import { useCallback, useMemo, useState } from 'react'
import { useCreateLink } from '../../queries/links.ts'
import type { LinkFieldErrors } from './errorFields.ts'
import { linkFieldErrors } from './errorFields.ts'
import type { OrganizationContext } from './organization.ts'
import {
  checkDestination,
  checkKeyword,
  expandedKeywordPreview,
  expandedPreview,
} from './validation.ts'

export interface CreateLinkFormOptions {
  organization: OrganizationContext
  /** Starting values, for the unknown-keyword screen's pre-filled keyword. */
  initialKeyword?: string
  initialNamespace?: string
  /** Called with the created link, for the caller to show or navigate to. */
  onCreated?: (link: Link) => void
}

export interface CreateLinkForm {
  namespace: string
  keyword: string
  destination: string
  setNamespace: (value: string) => void
  setKeyword: (value: string) => void
  setDestination: (value: string) => void
  /** Number of `%s` segments in the keyword as typed. */
  placeholderCount: number
  /** True once the keyword has a placeholder, which makes the link programmatic. */
  isProgrammatic: boolean
  /** The keyword with `%s` filled in, for the inline placeholder help. */
  keywordPreview: string
  /** The destination with `%s` filled in, or `null` when there is nothing to show. */
  destinationPreview: string | null
  /** Messages under each field: the organization's rules first, the API's answer after. */
  errors: LinkFieldErrors
  /** Whether Create can be pressed. */
  canSubmit: boolean
  isPending: boolean
  submit: () => Promise<Link | null>
  reset: () => void
}

/**
 * Holds one create form.
 *
 * Client-side messages are shown as the member types; the API's answer replaces
 * them once a request has been refused, and is dropped again as soon as the
 * offending field changes, so a stale "already exists" never sits under a
 * keyword that has since been rewritten.
 */
export function useCreateLinkForm(options: CreateLinkFormOptions): CreateLinkForm {
  const { organization, initialKeyword = '', initialNamespace, onCreated } = options

  const [namespace, setNamespaceValue] = useState(initialNamespace ?? organization.defaultNamespace)
  const [keyword, setKeywordValue] = useState(initialKeyword)
  const [destination, setDestinationValue] = useState('')
  const [serverErrors, setServerErrors] = useState<LinkFieldErrors>({})

  const createLink = useCreateLink()

  const keywordCheck = useMemo(
    () =>
      checkKeyword(keyword, organization.keywordRules, {
        namespace,
        defaultNamespace: organization.defaultNamespace,
        namespaces: organization.extraNamespaces,
      }),
    [keyword, namespace, organization],
  )

  const destinationCheck = useMemo(
    () => checkDestination(destination, keywordCheck.placeholderCount),
    [destination, keywordCheck.placeholderCount],
  )

  const setKeyword = useCallback((value: string) => {
    setKeywordValue(value)
    setServerErrors((current) =>
      current.keyword === undefined && current.existingLink === undefined
        ? current
        : { ...current, keyword: undefined, existingLink: undefined },
    )
  }, [])

  const setDestination = useCallback((value: string) => {
    setDestinationValue(value)
    setServerErrors((current) =>
      current.destination === undefined ? current : { ...current, destination: undefined },
    )
  }, [])

  const setNamespace = useCallback((value: string) => {
    setNamespaceValue(value)
    setServerErrors((current) =>
      current.namespace === undefined ? current : { ...current, namespace: undefined },
    )
  }, [])

  const errors: LinkFieldErrors = {
    ...serverErrors,
    ...(keywordCheck.error ? { keyword: keywordCheck.error } : {}),
    ...(destinationCheck.error ? { destination: destinationCheck.error } : {}),
  }

  const canSubmit =
    keyword.trim().length > 0 &&
    destination.trim().length > 0 &&
    keywordCheck.error === null &&
    destinationCheck.error === null &&
    !createLink.isPending &&
    !organization.readOnly

  const reset = useCallback(() => {
    setKeywordValue('')
    setDestinationValue('')
    setServerErrors({})
  }, [])

  const submit = useCallback(async (): Promise<Link | null> => {
    setServerErrors({})
    try {
      const link = await createLink.mutateAsync({
        keyword: keyword.trim(),
        destination: destination.trim(),
        ...(namespace === organization.defaultNamespace ? {} : { namespace }),
      })
      setKeywordValue('')
      setDestinationValue('')
      onCreated?.(link)
      return link
    } catch (error) {
      setServerErrors(linkFieldErrors(error))
      return null
    }
  }, [createLink, destination, keyword, namespace, onCreated, organization.defaultNamespace])

  return {
    namespace,
    keyword,
    destination,
    setNamespace,
    setKeyword,
    setDestination,
    placeholderCount: keywordCheck.placeholderCount,
    isProgrammatic: keywordCheck.placeholderCount > 0,
    keywordPreview: expandedKeywordPreview(keyword),
    destinationPreview: expandedPreview(destination, keywordCheck.placeholderCount),
    errors,
    canSubmit,
    isPending: createLink.isPending,
    submit,
    reset,
  }
}
