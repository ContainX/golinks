/**
 * The four things a row offers: copy the short form, open the destination, edit
 * the link, and everything else (ADR 0002 §1).
 *
 * Edit and the menu are disabled, with the rule spelled out, on a link the
 * member may not change — visibly present rather than hidden, so that the
 * directory reads the same for everyone and the reason is one hover away
 * (spec 08 §5).
 */

import type { Link } from '@golinks/shared/api'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/Edit'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import { useState } from 'react'

/** Why edit and the row menu are disabled (spec 03 §5). */
export const CANNOT_CHANGE_EXPLANATION = 'Only the owner or an admin can change this link'

/** Why "open destination" is disabled on a programmatic link (spec 03 §2.4). */
export const PROGRAMMATIC_OPEN_EXPLANATION =
  'This destination needs a value in place of %s, so there is nothing to open'

export interface LinkRowActionsProps {
  link: Link
  /** `go/handbook`, already built for this deployment. */
  shortForm: string
  onCopy: (link: Link) => void
  onEdit: (link: Link) => void
  onTransfer: (link: Link) => void
  onDelete: (link: Link) => void
}

export function LinkRowActions({
  link,
  shortForm,
  onCopy,
  onEdit,
  onTransfer,
  onDelete,
}: LinkRowActionsProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const canChange = link.permissions.canEdit

  return (
    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
      <Tooltip title={`Copy ${shortForm}`}>
        <IconButton size="small" aria-label={`Copy ${shortForm}`} onClick={() => onCopy(link)}>
          <ContentCopyIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      <Tooltip
        title={link.isProgrammatic ? PROGRAMMATIC_OPEN_EXPLANATION : 'Open destination'}
        arrow={link.isProgrammatic}
      >
        <span>
          <IconButton
            size="small"
            aria-label={`Open destination of ${link.fullPath}`}
            disabled={link.isProgrammatic}
            component="a"
            href={link.destination}
            target="_blank"
            rel="noreferrer noopener"
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={canChange ? 'Edit link' : CANNOT_CHANGE_EXPLANATION}>
        <span>
          <IconButton
            size="small"
            aria-label={`Edit ${link.fullPath}`}
            disabled={!canChange}
            onClick={() => onEdit(link)}
          >
            <EditIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={canChange ? 'More actions' : CANNOT_CHANGE_EXPLANATION}>
        <span>
          <IconButton
            size="small"
            aria-label={`More actions for ${link.fullPath}`}
            aria-haspopup="menu"
            disabled={!canChange}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          disabled={!link.permissions.canTransfer}
          onClick={() => {
            setMenuAnchor(null)
            onTransfer(link)
          }}
        >
          <ListItemIcon>
            <SwapHorizIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Transfer ownership</ListItemText>
        </MenuItem>
        <MenuItem
          disabled={!link.permissions.canDelete}
          onClick={() => {
            setMenuAnchor(null)
            onDelete(link)
          }}
        >
          <ListItemIcon>
            <DeleteOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Delete link</ListItemText>
        </MenuItem>
      </Menu>
    </Box>
  )
}
