import { SignInCard } from '../features/sign-in/SignInCard.tsx'

/**
 * `/_/login` (spec 08 §2, ADR 0002 §6).
 *
 * The API hands the browser here when a provider has to be chosen, when a
 * sign-in failed with a code from spec 02 §2.1 (`?error=`), and after
 * sign-out (`?signedOut=1`). It is the one screen in the app that is reached
 * without a session, so it shows nothing that needs one.
 */
export function SignInPage() {
  return <SignInCard />
}
