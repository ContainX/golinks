/**
 * The several forms one link takes on screen.
 *
 * A link is stored as a namespace and a display keyword, and the app has to
 * show three different things made out of them: the directory's label
 * (`eng/deploy`), the path the resolver answers (`/eng/deploy`), and the short
 * form a member types or pastes to a colleague (`go/eng/deploy`). The last two
 * differ from the first because the default namespace is implied by the host:
 * a request for `/deploy` on `go` means the default namespace, so the default
 * namespace never appears in a path (spec 04 §4).
 */

import type { Link, LinkSummary } from '@golinks/shared/api'

/** The namespace and keyword of a link, however the link was obtained. */
export interface KeywordAddress {
  namespace: string
  displayKeyword: string
}

/** `namespace/displayKeyword`: the label the directory shows (spec 05 §2.1). */
export function linkDisplayPath({ namespace, displayKeyword }: KeywordAddress): string {
  return `${namespace}/${displayKeyword}`
}

/**
 * The path the resolver answers for this link, without a leading slash.
 *
 * The default namespace is implied by the short host and is left out; every
 * other namespace is the first segment of the path (spec 04 §4).
 */
export function resolverPath(address: KeywordAddress, defaultNamespace: string): string {
  return address.namespace === defaultNamespace
    ? address.displayKeyword
    : `${address.namespace}/${address.displayKeyword}`
}

/** `go/handbook`: what "copy" puts on the clipboard and what members type. */
export function shortForm(
  address: KeywordAddress,
  defaultNamespace: string,
  shortHost: string,
): string {
  return `${shortHost}/${resolverPath(address, defaultNamespace)}`
}

/**
 * Splits a `fullPath` back into a namespace and a keyword.
 *
 * A transfer preview carries only the joined form (spec 05 §2.4), and the
 * screen that shows it still has to say what to type.
 */
export function addressFromFullPath(fullPath: string): KeywordAddress {
  const separator = fullPath.indexOf('/')
  if (separator <= 0) {
    return { namespace: '', displayKeyword: fullPath }
  }
  return {
    namespace: fullPath.slice(0, separator),
    displayKeyword: fullPath.slice(separator + 1),
  }
}

/** The address of a full link resource. */
export function linkAddress(link: Link): KeywordAddress {
  return { namespace: link.namespace, displayKeyword: link.displayKeyword }
}

/** The address of the link summary a transfer preview carries. */
export function summaryAddress(summary: LinkSummary): KeywordAddress {
  return addressFromFullPath(summary.fullPath)
}

/**
 * Recognizes what a member typed into the search field as one of these links
 * (ADR 0002 §2).
 *
 * Every form the member could reasonably have typed counts: the label
 * (`eng/deploy`), the resolver path (`deploy`), and the short form
 * (`go/eng/deploy`), with or without a leading slash. Matching is
 * case-insensitive because keywords are lowercased on the way in (spec 03
 * §2.1); it is deliberately not punctuation-insensitive, since the member is
 * being offered the exact link the directory is showing them.
 */
export function findTypedLink(
  typed: string,
  links: readonly Link[],
  defaultNamespace: string,
  shortHost: string,
): Link | null {
  const normalized = typed.trim().toLowerCase().replace(/^\/+/, '').replace(/\/+$/, '')
  if (normalized.length === 0) {
    return null
  }

  for (const link of links) {
    const address = linkAddress(link)
    const forms = [
      linkDisplayPath(address),
      resolverPath(address, defaultNamespace),
      shortForm(address, defaultNamespace, shortHost),
    ]
    if (forms.some((form) => form.toLowerCase() === normalized)) {
      return link
    }
  }

  return null
}
