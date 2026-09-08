/**
 * What `%s` means, explained where a member first types it (spec 08 §4).
 *
 * A programmatic keyword takes the rest of the path and substitutes it into the
 * destination (spec 03 §2.4, spec 04 §7). That is easiest to see rather than
 * read, so the help carries a worked example built from what has been typed so
 * far.
 */

import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { PLACEHOLDER_SAMPLE } from './validation.ts'

export interface PlaceholderHelpProps {
  /** The keyword with `%s` replaced by the sample value. */
  keywordPreview: string
  /** The destination with `%s` replaced, or `null` when it cannot be built yet. */
  destinationPreview: string | null
  /** Short host and namespace prefix, for example `go/`. */
  prefix: string
}

export function PlaceholderHelp({
  keywordPreview,
  destinationPreview,
  prefix,
}: PlaceholderHelpProps) {
  return (
    <Box
      sx={{
        mt: 1.5,
        px: 1.5,
        py: 1,
        borderRadius: 1,
        bgcolor: 'action.hover',
      }}
    >
      <Typography variant="body2" color="text.secondary">
        <strong>%s</strong> takes whatever is typed in its place and substitutes it into the
        destination. The destination needs one <strong>%s</strong> for each one in the keyword.
      </Typography>
      {destinationPreview === null ? null : (
        <Typography
          variant="body2"
          sx={{ mt: 0.5, fontFamily: 'monospace', wordBreak: 'break-all' }}
        >
          {prefix}
          {keywordPreview} goes to {destinationPreview}
        </Typography>
      )}
      {destinationPreview === null ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          Add a matching <strong>%s</strong> to the destination to see where{' '}
          <strong>{PLACEHOLDER_SAMPLE}</strong> would land.
        </Typography>
      ) : null}
    </Box>
  )
}
