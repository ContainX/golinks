import Typography from '@mui/material/Typography'
import { useSearchParams } from 'react-router'
import { PlaceholderScreen } from './PlaceholderScreen.tsx'

/**
 * Placeholder for the sign-in page (spec 08 §2).
 *
 * The API hands the browser here when it needs a provider chosen, when sign-in
 * failed with a code from spec 02 §2.1 (`?error=`), and after sign-out
 * (`?signedOut=1`). Until the page is designed, the raw code is shown as-is
 * rather than the member-facing message it maps to.
 */
export function SignInPage() {
  const [searchParams] = useSearchParams()
  const error = searchParams.get('error')
  const signedOut = searchParams.get('signedOut')

  return (
    <PlaceholderScreen
      title="Sign in"
      description="The provider chooser and sign-in messages will live here."
    >
      {error === null ? null : (
        <Typography>
          Sign-in error code: <code>{error}</code>
        </Typography>
      )}
      {signedOut === null ? null : (
        <Typography>
          Signed out: <code>{signedOut}</code>
        </Typography>
      )}
    </PlaceholderScreen>
  )
}
