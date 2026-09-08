/**
 * The create bar above the directory (ADR 0002 §1).
 *
 * Creating a link is the thing members come here to do, so it is the first
 * thing on the page and takes one line: where the keyword lives, what it is,
 * where it goes, Create.
 */

import type { Link } from '@golinks/shared/api'
import Paper from '@mui/material/Paper'
import { CreateLinkFields } from './CreateLinkFields.tsx'
import { useCreateLinkForm } from './createLinkForm.ts'
import type { OrganizationContext } from './organization.ts'

export interface CreateLinkBarProps {
  organization: OrganizationContext
  /** The new link, for the directory to show at the top of its table. */
  onCreated: (link: Link) => void
  /** Opens the drawer of a link a keyword collided with. */
  onOpenExisting: (link: Link) => void
}

export function CreateLinkBar({ organization, onCreated, onOpenExisting }: CreateLinkBarProps) {
  const form = useCreateLinkForm({ organization, onCreated })

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <CreateLinkFields
        form={form}
        organization={organization}
        layout="bar"
        onOpenExisting={onOpenExisting}
      />
    </Paper>
  )
}
