/**
 * The parts of the page an organization brands that live outside React: the
 * browser tab's title and its icon (spec 06 §2).
 *
 * Both are read from the document as it was served, so that "no branding" means
 * exactly what `index.html` shipped, and an organization that later clears a
 * branding field gets that back rather than a blank tab.
 */

import type { OrganizationBranding } from '@golinks/shared/settings'

/** How the document identified itself before any settings were loaded. */
export interface DocumentBrandingDefaults {
  title: string
  /** The `href` of the icon `index.html` declared, or `null` if it declared none. */
  iconHref: string | null
}

/** Matches `rel="icon"` and `rel="shortcut icon"` alike. */
const ICON_LINK_SELECTOR = 'link[rel~="icon"]'

function iconLink(doc: Document): HTMLLinkElement | null {
  return doc.head.querySelector<HTMLLinkElement>(ICON_LINK_SELECTOR)
}

/** Reads the served title and icon. Call once, before anything is applied. */
export function readDocumentBrandingDefaults(doc: Document): DocumentBrandingDefaults {
  return {
    title: doc.title,
    iconHref: iconLink(doc)?.getAttribute('href') ?? null,
  }
}

function applyIcon(href: string | null, doc: Document): void {
  const existing = iconLink(doc)

  if (href === null) {
    // Nothing was served and nothing is configured: leave no icon behind.
    existing?.remove()
    return
  }

  const link = existing ?? doc.head.appendChild(doc.createElement('link'))
  link.rel = 'icon'
  link.setAttribute('href', href)
}

/**
 * Applies an organization's branding to the document, or restores what was
 * served when there is no branding to apply — before `/me` has answered, or
 * for a member whose session has expired.
 */
export function applyDocumentBranding(
  branding: OrganizationBranding | null,
  defaults: DocumentBrandingDefaults,
  doc: Document,
): void {
  doc.title = branding?.title ?? defaults.title
  applyIcon(branding?.faviconUrl ?? defaults.iconHref, doc)
}
