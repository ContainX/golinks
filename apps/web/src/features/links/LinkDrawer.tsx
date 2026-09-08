/**
 * A link's own screen, slid over the directory at `/_/links/:id` (ADR 0002 §3).
 *
 * It is a drawer rather than a page because the directory is the context: a
 * member opens a link, changes it, and is back among the others. It is a URL
 * rather than local state because a link then has an address that can be sent
 * to someone, and because arriving at it directly must work.
 */

import type { Link } from '@golinks/shared/api'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { isApiErrorCode } from '../../api/errors.ts'
import { useLink } from '../../queries/links.ts'
import { copyToClipboard } from './clipboard.ts'
import { AdminBadge, LinkDetail } from './LinkDetail.tsx'
import { useNotify } from './Notices.tsx'
import type { OrganizationContext } from './organization.ts'
import { linkAddress, shortForm } from './paths.ts'

export interface LinkDrawerProps {
  linkId: string
  organization: OrganizationContext
  /** Closes the drawer: back to where the member came from, or to the directory. */
  onClose: () => void
  /** Swaps the drawer to another link, for a keyword collision. */
  onOpenLink: (link: Link) => void
}

const DRAWER_WIDTH = 520

export function LinkDrawer({ linkId, organization, onClose, onOpenLink }: LinkDrawerProps) {
  const notify = useNotify()
  const link = useLink(linkId)

  const missing = isApiErrorCode(link.error, 'not_found')

  // A member who may change nothing gets copy and open as full-width buttons in
  // the body instead (ADR 0002 §3), so the header does not offer them twice
  // under the same name.
  const showsHeaderActions =
    link.data !== undefined &&
    (link.data.permissions.canEdit || link.data.permissions.canEditDestination)
  const short =
    link.data === undefined
      ? ''
      : shortForm(linkAddress(link.data), organization.defaultNamespace, organization.shortHost)

  async function copyShortForm() {
    const copied = await copyToClipboard(short)
    notify(
      copied ? `Copied ${short}` : `Could not copy. The short form is ${short}`,
      copied ? 'success' : 'error',
    )
  }

  const showsAdminBadge =
    link.data !== undefined &&
    organization.isAdmin &&
    organization.userId !== null &&
    link.data.owner.id !== organization.userId

  return (
    <Drawer
      anchor="right"
      open
      onClose={onClose}
      slotProps={{
        paper: { sx: { width: { xs: '100%', sm: DRAWER_WIDTH }, maxWidth: '100%' } },
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ p: 2.5, alignItems: 'flex-start', justifyContent: 'space-between' }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Typography variant="h6" component="h2" sx={{ fontFamily: 'monospace' }}>
              {link.data?.fullPath ?? 'Link'}
            </Typography>
            {showsHeaderActions && link.data ? (
              <>
                <Tooltip title={`Copy ${short}`}>
                  <IconButton
                    size="small"
                    aria-label={`Copy ${short}`}
                    onClick={() => void copyShortForm()}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Open destination">
                  <span>
                    <IconButton
                      size="small"
                      aria-label="Open destination"
                      disabled={link.data.isProgrammatic}
                      component="a"
                      href={link.data.destination}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      <OpenInNewIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            ) : null}
          </Stack>
          {showsAdminBadge ? (
            <Box sx={{ mt: 1 }}>
              <AdminBadge />
            </Box>
          ) : null}
        </Box>
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Stack>

      {link.isPending ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress aria-label="Loading link" />
        </Box>
      ) : null}

      {link.isError ? (
        <Box sx={{ px: 2.5 }}>
          <Alert
            severity={missing ? 'info' : 'error'}
            action={
              missing ? (
                <Button color="inherit" size="small" onClick={onClose}>
                  Back
                </Button>
              ) : (
                <Button color="inherit" size="small" onClick={() => void link.refetch()}>
                  Retry
                </Button>
              )
            }
          >
            {missing
              ? 'This link no longer exists. It may have been deleted or renamed.'
              : 'This link could not be loaded.'}
          </Alert>
        </Box>
      ) : null}

      {link.data ? (
        <LinkDetail
          key={`${link.data.id}:${link.data.updatedAt}`}
          link={link.data}
          organization={organization}
          onClose={onClose}
          onDeleted={onClose}
          onOpenLink={onOpenLink}
        />
      ) : null}
    </Drawer>
  )
}
