// `GET /_/auth/providers`: the configured identity providers and whether test sign-in is on,
// for the web app's sign-in page (spec 02 §2 step 1). Public and cacheable for a minute.

import { SignInOptionsSchema } from '@golinks/shared/api'
import type { GoLinksApp } from '../types.ts'
import type { ProviderRegistry } from './oidc/registry.ts'

export const SIGN_IN_OPTIONS_PATH = '/_/auth/providers'

export function registerSignInOptionsRoute(app: GoLinksApp, providers: ProviderRegistry): void {
  app.get(
    SIGN_IN_OPTIONS_PATH,
    { schema: { response: { 200: SignInOptionsSchema } } },
    async (_request, reply) => {
      reply.header('cache-control', 'public, max-age=60')
      return {
        providers: providers.providers.map((provider) => ({
          id: provider.id,
          label: provider.label,
          iconUrl: provider.iconUrl ?? null,
        })),
        testSignIn: app.appConfig.authTest.enabled,
      }
    },
  )
}
