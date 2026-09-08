/**
 * The directory, and the two other things that live at the same place.
 *
 * Three addresses render this page (spec 04 §1, ADR 0002):
 *
 * - `/` and `/_/` — the directory itself;
 * - `/_/?keyword=<k>&namespace=<ns>` — where the resolver sends a keyword it
 *   could not find (spec 04 §8), which is a screen of its own rather than the
 *   directory with a form pre-filled;
 * - `/_/links/:id` — the directory with that link's drawer over it, so that
 *   every link has an address of its own.
 *
 * Which one is decided here, and nowhere else.
 */

import type { Link } from '@golinks/shared/api'
import Box from '@mui/material/Box'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { DirectoryScreen } from '../features/directory/DirectoryScreen.tsx'
import { LinkDrawer } from '../features/links/LinkDrawer.tsx'
import { NoticeProvider } from '../features/links/Notices.tsx'
import { useOrganizationContext } from '../features/links/organization.ts'
import { UnknownKeywordScreen } from '../features/links/UnknownKeywordScreen.tsx'

/** Kept for screen readers and page structure; the visible title is the app bar's. */

/** Marks a navigation that came from the directory, so closing can go back. */
interface DirectoryLocationState {
  fromDirectory?: boolean
}

export function DirectoryPage() {
  const [searchParams] = useSearchParams()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const organization = useOrganizationContext()

  const keyword = searchParams.get('keyword')?.trim() ?? ''
  const namespace = searchParams.get('namespace')?.trim() || null

  function openLink(link: Link) {
    void navigate(`/_/links/${link.id}`, { state: { fromDirectory: true } })
  }

  function closeDrawer() {
    // Returning to the directory means going back when that is where the member
    // came from, so their search and scroll survive; a link opened from its own
    // address has nothing behind it and lands on the directory (ADR 0002 §3).
    const state = location.state as DirectoryLocationState | null
    if (state?.fromDirectory) {
      void navigate(-1)
    } else {
      void navigate('/')
    }
  }

  if (keyword.length > 0) {
    return (
      <NoticeProvider>
        <UnknownKeywordScreen
          keyword={keyword}
          namespace={namespace}
          organization={organization}
          onBack={() => void navigate('/')}
          onOpenLink={openLink}
        />
      </NoticeProvider>
    )
  }

  return (
    <NoticeProvider>
      <Box>
        <DirectoryScreen organization={organization} />
        {id === undefined ? null : (
          <LinkDrawer
            linkId={id}
            organization={organization}
            onClose={closeDrawer}
            onOpenLink={openLink}
          />
        )}
      </Box>
    </NoticeProvider>
  )
}
