/**
 * The dense directory table (ADR 0002 §1).
 *
 * One row per link, sorted by whatever the toolbar asked for, with the whole
 * row clickable: opening the drawer is the commonest thing to do with a link
 * that is not copying it, and a member should not have to find a small icon to
 * do it.
 */

import type { Link } from '@golinks/shared/api'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { emailInitials, formatCount, formatRelativeTime } from '../links/format.ts'
import { linkAddress, shortForm } from '../links/paths.ts'
import { KeywordLabel } from './KeywordLabel.tsx'
import { LinkRowActions } from './LinkRowActions.tsx'

export interface DirectoryTableProps {
  links: readonly Link[]
  /** The signed-in member, so their own links can read "you" (spec 08 §3). */
  currentUserId: string | null
  defaultNamespace: string
  shortHost: string
  onOpen: (link: Link) => void
  onCopy: (link: Link) => void
  onTransfer: (link: Link) => void
  onDelete: (link: Link) => void
}

export function DirectoryTable({
  links,
  currentUserId,
  defaultNamespace,
  shortHost,
  onOpen,
  onCopy,
  onTransfer,
  onDelete,
}: DirectoryTableProps) {
  return (
    <TableContainer>
      <Table size="small" aria-label="Links">
        <TableHead>
          <TableRow>
            <TableCell>Keyword</TableCell>
            <TableCell>Destination</TableCell>
            <TableCell>Owner</TableCell>
            <TableCell align="right">Visits</TableCell>
            <TableCell align="right" sx={{ width: 176 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {links.map((link) => {
            const isMine = currentUserId !== null && link.owner.id === currentUserId
            return (
              <TableRow
                key={link.id}
                hover
                onClick={() => onOpen(link)}
                sx={{ cursor: 'pointer', '& td': { borderColor: 'divider' } }}
              >
                <TableCell>
                  <KeywordLabel
                    namespace={link.namespace}
                    displayKeyword={link.displayKeyword}
                    isProgrammatic={link.isProgrammatic}
                    isUnlisted={link.isUnlisted}
                  />
                </TableCell>
                <TableCell
                  sx={{
                    color: 'text.secondary',
                    maxWidth: 360,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {link.destination}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Tooltip title={link.owner.email}>
                      <Avatar sx={{ width: 24, height: 24, fontSize: 11 }}>
                        {emailInitials(link.owner.email)}
                      </Avatar>
                    </Tooltip>
                    <Typography variant="body2" color="text.secondary">
                      {isMine ? 'you' : link.owner.email}
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <Tooltip title={`Last used: ${formatRelativeTime(link.lastVisitedAt)}`}>
                    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatCount(link.visitCount)}
                    </Typography>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">
                  <LinkRowActions
                    link={link}
                    shortForm={shortForm(linkAddress(link), defaultNamespace, shortHost)}
                    onCopy={onCopy}
                    onEdit={onOpen}
                    onTransfer={onTransfer}
                    onDelete={onDelete}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
