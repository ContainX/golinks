/**
 * Deleting a link, deliberately (spec 08 §5).
 *
 * Deletion is permanent and takes the link's visit history with it (spec 03
 * §8), and the keyword stops working for everyone at once — so the dialog
 * states what will happen rather than asking "are you sure". A link that has
 * been used more than a hundred times is load-bearing for other people, and
 * confirming it means typing its keyword.
 */

import type { Link } from '@golinks/shared/api'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import { useState } from 'react'
import { useDeleteLink } from '../../queries/links.ts'
import { linkFieldErrors } from './errorFields.ts'
import { formatCount } from './format.ts'
import { useNotify } from './Notices.tsx'
import type { OrganizationContext } from './organization.ts'
import { shortForm } from './paths.ts'

/** Above this many visits, deleting means typing the keyword (spec 08 §5). */
export const TYPE_TO_CONFIRM_VISITS = 100

export interface DeleteLinkDialogProps {
  link: Link
  open: boolean
  onClose: () => void
  organization: OrganizationContext
  /** Called once the link is gone, for the caller to leave the screen it was on. */
  onDeleted: () => void
}

export function DeleteLinkDialog({
  link,
  open,
  onClose,
  organization,
  onDeleted,
}: DeleteLinkDialogProps) {
  const notify = useNotify()
  const deleteLink = useDeleteLink()
  const [typed, setTyped] = useState('')

  const mustType = link.visitCount > TYPE_TO_CONFIRM_VISITS
  const confirmed =
    !mustType ||
    typed.trim().toLowerCase() === link.displayKeyword.toLowerCase() ||
    typed.trim().toLowerCase() === link.fullPath.toLowerCase()

  const short = shortForm(
    { namespace: link.namespace, displayKeyword: link.displayKeyword },
    organization.defaultNamespace,
    organization.shortHost,
  )

  const errors = deleteLink.isError ? linkFieldErrors(deleteLink.error) : {}

  async function confirmDelete() {
    try {
      await deleteLink.mutateAsync(link.id)
      notify(`Deleted ${link.fullPath}`)
      onDeleted()
    } catch {
      // The message is rendered below; nothing else to do here.
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Delete {link.fullPath}?</DialogTitle>
      <DialogContent>
        <DialogContentText component="div">
          This cannot be undone. {short} stops working for everyone in the organization, and its{' '}
          {formatCount(link.visitCount)} recorded visit{link.visitCount === 1 ? '' : 's'}{' '}
          {link.visitCount === 1 ? 'is' : 'are'} deleted with it. The keyword becomes free for
          anyone to create again.
        </DialogContentText>

        {mustType ? (
          <TextField
            fullWidth
            sx={{ mt: 2 }}
            label={`Type ${link.displayKeyword} to confirm`}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
          />
        ) : null}

        {errors.general ? (
          <Alert severity="error" sx={{ mt: 2 }}>
            {errors.general}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="error"
          variant="contained"
          disabled={!confirmed || deleteLink.isPending}
          onClick={() => void confirmDelete()}
        >
          Delete link
        </Button>
      </DialogActions>
    </Dialog>
  )
}
