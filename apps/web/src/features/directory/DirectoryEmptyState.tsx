/**
 * What an organization sees before it has any links, and what a search that
 * matched nothing shows (ADR 0002 §8).
 *
 * The first-run text has one job: explain what a keyword is for and how to make
 * `go/` work in the browser, because a member who creates a link and then finds
 * that typing it does nothing concludes the product is broken (spec 11).
 */

import LinkOffIcon from '@mui/icons-material/LinkOff'
import SearchOffIcon from '@mui/icons-material/SearchOff'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'

export interface DirectoryOnboardingProps {
  /** Hostname members type, for example `go`. */
  shortHost: string
  /** Where the app is served, which resolves keywords whatever the browser knows. */
  baseUrl: string
  /** The namespace a keyword lands in when none is named. */
  defaultNamespace: string
}

/** The first-run explanation, shown in place of the table (ADR 0002 §8). */
export function DirectoryOnboarding({
  shortHost,
  baseUrl,
  defaultNamespace,
}: DirectoryOnboardingProps) {
  const example = `${shortHost}/handbook`

  return (
    <Box sx={{ px: 3, py: 6, textAlign: 'center', maxWidth: 640, mx: 'auto' }}>
      <LinkOffIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
      <Typography variant="h6" sx={{ mt: 1 }}>
        No links yet
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 1 }}>
        A link gives a page a short name everyone can remember. Create{' '}
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          {example}
        </Box>{' '}
        and anyone in your organization can type it into the address bar and land on the page it
        points to.
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 2 }}>
        For{' '}
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          {shortHost}/
        </Box>{' '}
        to work in a browser, the name{' '}
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          {shortHost}
        </Box>{' '}
        has to point at this service on your network. Until it does, every keyword also resolves at{' '}
        <Box component="span" sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
          {baseUrl}
        </Box>
        .
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 2 }}>
        Use the bar above to make the first one. Keywords without a namespace live in{' '}
        <Box component="span" sx={{ fontFamily: 'monospace' }}>
          {defaultNamespace}
        </Box>
        .
      </Typography>
    </Box>
  )
}

export interface DirectoryNoResultsProps {
  /** Clears the search and the chip. */
  onClear: () => void
}

/** Nothing matched the current search or chip; the organization is not empty. */
export function DirectoryNoResults({ onClear }: DirectoryNoResultsProps) {
  return (
    <Box sx={{ px: 3, py: 6, textAlign: 'center' }}>
      <SearchOffIcon sx={{ fontSize: 36, color: 'text.disabled' }} />
      <Typography variant="subtitle1" sx={{ mt: 1 }}>
        No links match
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
        Try a different search, or create the keyword with the bar above.
      </Typography>
      <Button onClick={onClear} sx={{ mt: 2 }}>
        Clear filters
      </Button>
    </Box>
  )
}
