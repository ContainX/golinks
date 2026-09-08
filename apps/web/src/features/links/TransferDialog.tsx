/**
 * Handing a link to a colleague (spec 03 §9.2, spec 08 §6).
 *
 * A transfer is a URL rather than a member picker: the owner generates one,
 * sends it to whoever is taking the link over, and that person accepts it. The
 * dialog mints the URL as it opens — which also revokes any earlier pending
 * offer for this link — and then exists only to be copied from.
 */

import type { Link } from '@golinks/shared/api'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useRef } from 'react'
import { useCreateTransfer } from '../../queries/links.ts'
import { copyToClipboard } from './clipboard.ts'
import { linkFieldErrors } from './errorFields.ts'
import { formatExpiry } from './format.ts'
import { useNotify } from './Notices.tsx'
import type { OrganizationContext } from './organization.ts'

export interface TransferDialogProps {
  link: Link
  open: boolean
  onClose: () => void
  organization: OrganizationContext
}

export function TransferDialog({ link, open, onClose, organization }: TransferDialogProps) {
  const notify = useNotify()
  const transfer = useCreateTransfer()
  const requested = useRef(false)

  // Minted once per opening. The guard matters because creating a transfer
  // revokes the previous one (spec 03 §9.2), so a second call would quietly
  // invalidate a URL the member may already have copied.
  useEffect(() => {
    if (!open) {
      requested.current = false
      return
    }
    if (requested.current) {
      return
    }
    requested.current = true
    transfer.mutate(link.id)
  }, [link.id, open, transfer])

  const url = transfer.data?.url ?? ''
  const errors = transfer.isError ? linkFieldErrors(transfer.error) : {}

  async function copyUrl() {
    const copied = await copyToClipboard(url)
    notify(
      copied ? 'Transfer link copied' : 'Could not copy the transfer link',
      copied ? 'success' : 'error',
    )
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Transfer {link.fullPath}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Send this link to the member who should own {link.fullPath}. The first person in{' '}
          {organization.isLoaded ? 'your organization' : 'the organization'} to open it and accept
          becomes the owner; until then nothing changes.
        </Typography>

        {transfer.isPending ? (
          <CircularProgress size={24} aria-label="Creating the transfer link" />
        ) : null}

        {transfer.isError ? (
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" onClick={() => transfer.mutate(link.id)}>
                Retry
              </Button>
            }
          >
            {errors.general ?? 'The transfer link could not be created.'}
          </Alert>
        ) : null}

        {transfer.data ? (
          <>
            <TextField
              fullWidth
              label="Transfer link"
              value={url}
              slotProps={{
                htmlInput: { readOnly: true, 'aria-label': 'Transfer link' },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton aria-label="Copy transfer link" onClick={() => void copyUrl()}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              Expires {formatExpiry(transfer.data.expiresAt)}. Creating another transfer link for
              this link replaces this one.
            </Typography>
          </>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" disabled={!transfer.data} onClick={() => void copyUrl()}>
          Copy link
        </Button>
      </DialogActions>
    </Dialog>
  )
}
