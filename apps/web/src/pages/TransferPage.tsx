import Typography from '@mui/material/Typography'
import { useParams } from 'react-router'
import { PlaceholderScreen } from './PlaceholderScreen.tsx'

/**
 * Placeholder for accepting or declining an ownership transfer (spec 08 §6).
 * The token in the path is previewed through the API before anything is shown
 * to the member; for now it is only echoed back.
 */
export function TransferPage() {
  const { token } = useParams<{ token: string }>()

  return (
    <PlaceholderScreen
      title="Ownership transfer"
      description="The transfer preview, with accept and decline, will live here."
    >
      <Typography>
        Token: <code>{token}</code>
      </Typography>
    </PlaceholderScreen>
  )
}
