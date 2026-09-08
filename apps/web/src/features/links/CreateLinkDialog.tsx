/**
 * The create form on a phone (ADR 0002 §9).
 *
 * There is no room for a bar across the top of a narrow screen, so the same
 * form opens in a dialog from the floating action button. It closes itself once
 * a link has been created; a refusal keeps it open with the message under the
 * field it belongs to.
 */

import type { Link } from '@golinks/shared/api'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import { CREATE_HELP, CreateLinkFields } from './CreateLinkFields.tsx'
import { useCreateLinkForm } from './createLinkForm.ts'
import type { OrganizationContext } from './organization.ts'

export interface CreateLinkDialogProps {
  open: boolean
  onClose: () => void
  organization: OrganizationContext
  onCreated: (link: Link) => void
  onOpenExisting: (link: Link) => void
}

export function CreateLinkDialog({
  open,
  onClose,
  organization,
  onCreated,
  onOpenExisting,
}: CreateLinkDialogProps) {
  const form = useCreateLinkForm({
    organization,
    onCreated: (link) => {
      onCreated(link)
      onClose()
    },
  })

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create a link</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {CREATE_HELP}
        </Typography>
        <CreateLinkFields
          form={form}
          organization={organization}
          layout="stacked"
          onOpenExisting={onOpenExisting}
        />
      </DialogContent>
    </Dialog>
  )
}
