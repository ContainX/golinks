/**
 * The directory on a phone (ADR 0002 §9).
 *
 * A five-column table does not fit a narrow screen, so each link becomes two
 * lines — keyword above, destination below — with copy kept to hand, since
 * copying a short form is the one thing a member is most likely to be doing
 * from a phone. Everything else is in the drawer, one tap away.
 */

import type { Link } from '@golinks/shared/api'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemButton from '@mui/material/ListItemButton'
import Typography from '@mui/material/Typography'
import { Fragment } from 'react'
import { linkAddress, shortForm } from '../links/paths.ts'
import { KeywordLabel } from './KeywordLabel.tsx'

export interface DirectoryListProps {
  links: readonly Link[]
  defaultNamespace: string
  shortHost: string
  onOpen: (link: Link) => void
  onCopy: (link: Link) => void
}

export function DirectoryList({
  links,
  defaultNamespace,
  shortHost,
  onOpen,
  onCopy,
}: DirectoryListProps) {
  return (
    <List disablePadding aria-label="Links">
      {links.map((link, index) => {
        const copyLabel = `Copy ${shortForm(linkAddress(link), defaultNamespace, shortHost)}`
        return (
          <Fragment key={link.id}>
            {index === 0 ? null : <Divider component="li" />}
            <ListItem
              disablePadding
              secondaryAction={
                <IconButton edge="end" aria-label={copyLabel} onClick={() => onCopy(link)}>
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              }
            >
              <ListItemButton onClick={() => onOpen(link)} sx={{ py: 1.25 }}>
                <span style={{ minWidth: 0 }}>
                  <KeywordLabel
                    namespace={link.namespace}
                    displayKeyword={link.displayKeyword}
                    isProgrammatic={link.isProgrammatic}
                    isUnlisted={link.isUnlisted}
                  />
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mt: 0.25,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {link.destination}
                  </Typography>
                </span>
              </ListItemButton>
            </ListItem>
          </Fragment>
        )
      })}
    </List>
  )
}
