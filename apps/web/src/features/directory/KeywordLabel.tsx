/**
 * A link's keyword as the directory shows it: the namespace, the keyword, and
 * the two things worth knowing at a glance (spec 08 §3).
 *
 * A programmatic link carries a `%s` badge, and an unlisted one an eye with the
 * rule behind it, because "unlisted" is the one property of a link whose
 * meaning is not obvious from its name (spec 03 §4).
 */

import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

/** What being unlisted means, in one sentence (spec 03 §4). */
export const UNLISTED_EXPLANATION =
  'Unlisted: anyone who knows the keyword can use it, but only its owner and admins see it in the directory.'

/** What a `%s` segment does (spec 03 §2.4, spec 04 §7). */
export const PROGRAMMATIC_EXPLANATION =
  'Programmatic: whatever is typed in place of %s is substituted into the destination.'

export interface KeywordLabelProps {
  namespace: string
  displayKeyword: string
  isProgrammatic: boolean
  isUnlisted: boolean
}

export function KeywordLabel({
  namespace,
  displayKeyword,
  isProgrammatic,
  isUnlisted,
}: KeywordLabelProps) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
      <Typography
        component="span"
        variant="body2"
        sx={{ fontWeight: 500, fontFamily: 'monospace', whiteSpace: 'nowrap' }}
      >
        <Box component="span" sx={{ color: 'text.secondary' }}>
          {namespace}/
        </Box>
        {displayKeyword}
      </Typography>
      {isProgrammatic ? (
        <Tooltip title={PROGRAMMATIC_EXPLANATION}>
          <Chip label="%s" size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        </Tooltip>
      ) : null}
      {isUnlisted ? (
        <Tooltip title={UNLISTED_EXPLANATION}>
          <VisibilityOffIcon
            fontSize="small"
            aria-label="Unlisted"
            sx={{ color: 'text.disabled' }}
          />
        </Tooltip>
      ) : null}
    </Box>
  )
}
