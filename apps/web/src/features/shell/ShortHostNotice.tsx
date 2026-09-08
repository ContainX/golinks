/**
 * How to make the short host work in this browser (spec 08 §7, spec 11).
 *
 * The product is `go/handbook`, and typing that only works once the name `go`
 * resolves to the service. Three ways to arrange it are documented in spec 11
 * §1; all three are here, because which one a member can use depends on
 * whether they control the network, their own machine, or only their browser.
 * Closing it is remembered against the member (spec 01 §2.5), so it is shown
 * once per person rather than once per session.
 */

import type { AppInfo } from '@golinks/shared/api'
import Alert from '@mui/material/Alert'
import AlertTitle from '@mui/material/AlertTitle'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Link from '@mui/material/Link'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useState } from 'react'
import { FONT_MONO } from '../../app/theme.ts'

/** The path the API serves the search-engine description from (spec 11 §3). */
const OPENSEARCH_PATH = '/_/opensearch.xml'

/** A documentation address (RFC 5737), so the example cannot be pasted as-is. */
const EXAMPLE_ADDRESS = '203.0.113.10'

export interface ShortHostNoticeProps {
  app: AppInfo
  onDismiss: () => void
}

/** The canonical host members' browsers are actually sent to (spec 11 §2). */
function canonicalHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host
  } catch {
    return baseUrl
  }
}

/** Inline monospace, for something to be typed or pasted exactly. */
function Code({ children }: { children: string }) {
  return (
    <Box
      component="code"
      sx={{
        fontFamily: FONT_MONO,
        fontSize: '0.85em',
        px: 0.5,
        py: 0.15,
        borderRadius: 0.5,
        bgcolor: 'action.hover',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </Box>
  )
}

export function ShortHostNotice({ app, onDismiss }: ShortHostNoticeProps) {
  const { shortHost } = app
  const host = canonicalHost(app.baseUrl)
  // On a phone the full explanation would fill the first screen, so it starts folded to its
  // title there and opens on request; on a desktop it is short enough to show at once.
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('md'))
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const open = expanded ?? !narrow

  return (
    <Alert severity="info" onClose={onDismiss} sx={{ mb: 3 }}>
      <AlertTitle sx={{ mb: open ? undefined : 0 }}>
        Make {shortHost}/ work in your browser
      </AlertTitle>
      {narrow ? (
        <Button
          size="small"
          onClick={() => setExpanded(!open)}
          aria-expanded={open}
          sx={{ px: 0.5, mb: open ? 1 : 0 }}
        >
          {open ? 'Hide' : 'Show how'}
        </Button>
      ) : null}
      <Collapse in={open} unmountOnExit>
        <Typography variant="body2">
          Links are typed as <Code>{`${shortHost}/handbook`}</Code>, which works once the name{' '}
          <Code>{shortHost}</Code> reaches this service. Any one of these is enough.
        </Typography>
        <Box component="ol" sx={{ pl: 2.5, my: 1.5, display: 'grid', gap: 1 }}>
          <Typography component="li" variant="body2">
            <strong>A DNS record</strong>, which fixes it for everyone at once: ask whoever runs
            your network for an <Code>A</Code> or <Code>CNAME</Code> record for the bare name{' '}
            <Code>{shortHost}</Code> pointing at <Code>{host}</Code>.
          </Typography>
          <Typography component="li" variant="body2">
            <strong>A hosts-file entry</strong>, for one machine: add a line pointing{' '}
            <Code>{shortHost}</Code> at this service's address, for example{' '}
            <Code>{`${EXAMPLE_ADDRESS}  ${shortHost}`}</Code>.
          </Typography>
          <Typography component="li" variant="body2">
            <strong>A browser search keyword</strong>, which needs no DNS at all: add this site as a
            search engine — its description is at{' '}
            <Link href={OPENSEARCH_PATH} target="_blank" rel="noreferrer">
              {OPENSEARCH_PATH}
            </Link>{' '}
            — and give it the keyword <Code>{shortHost}</Code>. Then{' '}
            <Code>{`${shortHost} handbook`}</Code> in the address bar goes to the link.
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          After the first two, some browsers need one visit to <Code>{`http://${shortHost}/`}</Code>{' '}
          before they stop reading a single-word address as a search.
        </Typography>
      </Collapse>
    </Alert>
  )
}
