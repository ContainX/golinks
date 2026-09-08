/**
 * Accepting an ownership transfer at `/_/transfer/:token` (spec 08 §6).
 *
 * The token in the path is the whole of what this screen knows; everything
 * shown comes from previewing it against the API before anything changes hands
 * (spec 03 §9.2).
 */

import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { useParams } from 'react-router'
import { NoticeProvider } from '../features/links/Notices.tsx'
import { TransferAcceptScreen } from '../features/links/TransferAcceptScreen.tsx'

export function TransferPage() {
  const { token } = useParams<{ token: string }>()

  if (token === undefined || token.length === 0) {
    return (
      <Box sx={{ p: 4, maxWidth: 640, mx: 'auto' }}>
        <Typography variant="h5" component="h1">
          Ownership transfer
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          This address is missing its transfer token. Ask whoever sent it to you for the full link.
        </Typography>
      </Box>
    )
  }

  return (
    <NoticeProvider>
      <TransferAcceptScreen token={token} />
    </NoticeProvider>
  )
}
