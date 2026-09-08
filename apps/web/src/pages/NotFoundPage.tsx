import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router'
import { DIRECTORY_PATH } from '../features/shell/navigation.ts'

/**
 * Reached only for an unknown path under `/_/`. Every path outside `/` and
 * `/_/` belongs to the resolver and never reaches the client router at all
 * (spec 04 §1), so this screen never stands for a keyword that does not
 * exist — a missing keyword is the resolver's business, and it answers one by
 * sending the member to `/_/?keyword=` instead.
 */
export function NotFoundPage() {
  return (
    <Box component="section" sx={{ maxWidth: 520, mx: 'auto', py: 6, textAlign: 'center' }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Page not found
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        No application page answers to this address.
      </Typography>
      <Button component={RouterLink} to={DIRECTORY_PATH} variant="contained">
        Go to the directory
      </Button>
    </Box>
  )
}
