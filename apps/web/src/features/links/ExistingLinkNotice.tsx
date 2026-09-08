/**
 * The link a keyword collided with, shown instead of only an error (spec 08 §4).
 *
 * `keyword_exists` and `keyword_conflict` both carry the link they collided
 * with (spec 05 §4). Nine times in ten the member wanted that link, so it is
 * shown with its destination and a way straight into it.
 */

import type { Link } from '@golinks/shared/api'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

export interface ExistingLinkNoticeProps {
  /** The link the API named. */
  link: Link
  /** The refusal's own message, which says whether it was an exact match. */
  message?: string | undefined
  /** Opens the link's drawer. */
  onOpen: (link: Link) => void
}

export function ExistingLinkNotice({ link, message, onOpen }: ExistingLinkNoticeProps) {
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={() => onOpen(link)}>
          Open
        </Button>
      }
      sx={{ alignItems: 'center' }}
    >
      <AlertTitle sx={{ mb: 0 }}>{message ?? `${link.fullPath} already exists.`}</AlertTitle>
      <Typography variant="body2" component="div" sx={{ wordBreak: 'break-all' }}>
        {link.fullPath} goes to {link.destination}
      </Typography>
    </Alert>
  )
}
