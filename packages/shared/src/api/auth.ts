// What the sign-in page needs to render its choices (spec 02 §2 step 1). Public: it is read
// before anyone is signed in and reveals only what the provider buttons show anyway.

import { z } from 'zod'

export const SignInProviderSchema = z.object({
  /** The provider id used in `/_/auth/start/:providerId`. */
  id: z.string().min(1),
  /** Button text. */
  label: z.string().min(1),
  iconUrl: z.string().nullable(),
})
export type SignInProvider = z.infer<typeof SignInProviderSchema>

export const SignInOptionsSchema = z.object({
  providers: z.array(SignInProviderSchema),
  /** True when the deployment accepts test sign-in tokens (never in production). */
  testSignIn: z.boolean(),
})
export type SignInOptions = z.infer<typeof SignInOptionsSchema>
