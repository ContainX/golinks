/**
 * What the app bar navigates between (ADR 0002 §5).
 *
 * Two sections, and the second one only for admins: the directory at `/` and
 * administration at `/_/admin`. Everything else a member reaches — a link's
 * drawer, the unknown-keyword screen, the transfer preview — is part of the
 * directory rather than a place of its own, which is why active state is
 * decided by a rule per section instead of by an exact path match.
 */

import type { UserRole } from '@golinks/shared/api'

/** The directory (spec 08 §3). */
export const DIRECTORY_PATH = '/'

/** Administration (spec 08 §8). Admins only. */
export const ADMIN_PATH = '/_/admin'

export interface ShellSection {
  id: 'directory' | 'admin'
  label: string
  to: string
}

const SECTIONS: readonly ShellSection[] = [
  { id: 'directory', label: 'Directory', to: DIRECTORY_PATH },
  { id: 'admin', label: 'Admin', to: ADMIN_PATH },
]

/** The sections a member of this role may see. */
export function sectionsFor(role: UserRole): ShellSection[] {
  return SECTIONS.filter((section) => section.id !== 'admin' || role === 'admin')
}

/**
 * Whether a section is the one being looked at.
 *
 * The directory owns three addresses: `/`, the `/_/` a resolver miss lands on
 * (spec 04 §8), and `/_/links/:id`, which is the directory with one link's
 * drawer open. Administration owns everything under `/_/admin`.
 */
export function isSectionActive(section: ShellSection, pathname: string): boolean {
  if (section.id === 'admin') {
    return pathname === ADMIN_PATH || pathname.startsWith(`${ADMIN_PATH}/`)
  }
  return pathname === '/' || pathname === '/_/' || pathname.startsWith('/_/links')
}
