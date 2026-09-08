/**
 * The sign-in page (ADR 0002 §6, spec 08 §2).
 *
 * Most members never see it. `/_/auth/login` sends the browser straight to the
 * single configured provider when there is one and nothing has gone wrong
 * (spec 02 §2 step 1); this page exists for the deployments with more than one
 * provider, for the six ways a sign-in can fail, and for the moment after
 * signing out.
 *
 * Every provider is an ordinary link, not a fetch: signing in means leaving the
 * app for the API, which sets a login cookie and redirects to the identity
 * provider. A member who was on their way to a keyword carries that with them
 * in `redirectTo`, and lands there afterwards rather than at the directory.
 */

import { DEFAULT_BRANDING_TITLE } from '@golinks/shared/settings'
import LinkIcon from '@mui/icons-material/Link'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useSearchParams } from 'react-router'
import { signInStartUrl } from '../../api/auth.ts'
import { useBranding } from '../../app/BrandingProvider.tsx'
import { useSignInOptions } from '../../queries/auth.ts'
import { useMe } from '../../queries/me.ts'
import { keywordFromRedirectTo, shortFormOf } from './redirectTo.ts'
import { signInErrorMessage } from './signInMessages.ts'

/**
 * The short host to write a keyword with when the deployment has not said.
 *
 * `/me` carries the real one, but reading it needs a session and there is none
 * here. `go` is what `SHORT_HOST` defaults to and what every example in the
 * specs is written with, so it is the right guess when there is nothing to
 * read; a member who is already signed in sees the deployment's own.
 */
const FALLBACK_SHORT_HOST = 'go'

export function SignInCard() {
  const [searchParams] = useSearchParams()
  const branding = useBranding()
  const { data: me } = useMe()
  const { data: options, isPending, isError } = useSignInOptions()

  const errorMessage = signInErrorMessage(searchParams.get('error'))
  const isSignedOut = searchParams.get('signedOut') !== null
  const redirectTo = searchParams.get('redirectTo')
  const keyword = keywordFromRedirectTo(redirectTo)
  const shortHost = me?.app.shortHost ?? FALLBACK_SHORT_HOST

  const title = branding?.title ?? DEFAULT_BRANDING_TITLE
  const logoUrl = branding?.logoUrl ?? null
  const providers = options?.providers ?? []

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: { xs: 2, md: 6 } }}>
      <Paper sx={{ width: '100%', maxWidth: 420, p: { xs: 3, sm: 5 }, display: 'grid', gap: 3 }}>
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
          {logoUrl === null ? (
            <LinkIcon color="primary" sx={{ fontSize: 40 }} />
          ) : (
            <Box component="img" src={logoUrl} alt="" sx={{ height: 40, width: 'auto' }} />
          )}
          <Typography variant="h5" component="h1">
            Sign in to {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Use your organization account. Links you create belong to you.
          </Typography>
        </Stack>

        {errorMessage === null ? null : <Alert severity="error">{errorMessage}</Alert>}

        {isSignedOut ? (
          <Alert severity="success">
            You are signed out. Sign in again whenever you need your links.
          </Alert>
        ) : null}

        {isPending ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
            <CircularProgress aria-label="Loading sign-in options" />
          </Box>
        ) : null}

        {isError ? (
          <Alert severity="warning">
            The sign-in options could not be loaded. Reload the page to try again.
          </Alert>
        ) : null}

        {providers.length === 0 ? null : (
          <Stack spacing={1.5}>
            {providers.map((provider, index) => (
              <Button
                key={provider.id}
                href={signInStartUrl(provider.id, redirectTo)}
                variant={index === 0 ? 'contained' : 'outlined'}
                size="large"
                fullWidth
                startIcon={
                  provider.iconUrl === null ? undefined : (
                    <Box
                      component="img"
                      src={provider.iconUrl}
                      alt=""
                      sx={{ width: 18, height: 18 }}
                    />
                  )
                }
              >
                {provider.label}
              </Button>
            ))}
          </Stack>
        )}

        {options !== undefined && providers.length === 0 ? (
          <Alert severity={options.testSignIn ? 'info' : 'warning'}>
            {options.testSignIn
              ? 'No identity provider is configured. This deployment has test sign-in enabled, so automated tests can sign in with a test token.'
              : 'No identity provider is configured for this deployment. An administrator has to add one before anyone can sign in.'}
          </Alert>
        ) : null}

        {keyword === null ? null : (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
            You were headed to {shortFormOf(shortHost, keyword)}. You will land there after signing
            in.
          </Typography>
        )}
      </Paper>
    </Box>
  )
}
