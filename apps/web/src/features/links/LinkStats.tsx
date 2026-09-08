/**
 * How much a link is used, at the top of the drawer (spec 08 §3).
 *
 * Three numbers decide most questions a member has about a link they did not
 * create: is anyone using this, is it still current, how old is it.
 */

import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { formatCount, formatRelativeTime, formatShortDate } from './format.ts'

export interface LinkStatsProps {
  visitCount: number
  lastVisitedAt: string | null
  createdAt: string
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ flex: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="subtitle1">{value}</Typography>
    </Box>
  )
}

export function LinkStats({ visitCount, lastVisitedAt, createdAt }: LinkStatsProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        px: 2,
        py: 1.5,
        bgcolor: 'action.hover',
        borderRadius: 1,
      }}
    >
      <Stat label="Visits" value={formatCount(visitCount)} />
      <Stat label="Last used" value={formatRelativeTime(lastVisitedAt)} />
      <Stat label="Created" value={formatShortDate(createdAt)} />
    </Box>
  )
}
