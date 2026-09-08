// The identity providers a deployment can sign members in with (spec 02 §1).
//
// Every provider named by the configuration gets one entry here. An entry knows how to reach
// its provider: the discovery document at `<issuer>/.well-known/openid-configuration` is
// fetched once, kept for as long as it keeps working, and dropped the moment a sign-in fails
// against it, so a provider that rotates its endpoints or its keys is picked up on the next
// attempt rather than at the next restart.
//
// A deployment may have no provider at all — spec 02 §1 allows that only with the test
// sign-in of §8 enabled — in which case the registry is simply empty and every provider id is
// unknown.

import type { DeploymentConfig, OidcProvider } from '@golinks/shared/config'
import type { FastifyBaseLogger } from 'fastify'
import { allowInsecureRequests, type Configuration, discovery } from 'openid-client'

/** One configured provider and the discovery it is reached through. */
export interface RegisteredProvider {
  readonly provider: OidcProvider
  /** The discovered configuration, fetched on first use and remembered afterwards. */
  configuration(): Promise<Configuration>
  /** Forgets the discovery document, so the next sign-in fetches it again. */
  forget(): void
}

export interface ProviderRegistry {
  /** Every configured provider, in the order the configuration named them. */
  readonly providers: readonly OidcProvider[]
  /** The entry for a provider id, or undefined when nothing is configured under it. */
  get(id: string): RegisteredProvider | undefined
  /**
   * The one configured provider, or undefined when there are none or several. This is what
   * decides the shortcut of spec 02 §2 step 1.
   */
  only(): RegisteredProvider | undefined
}

export interface ProviderRegistryOptions {
  /** Where discovery trouble is reported. */
  logger?: FastifyBaseLogger
  /** Replaces the discovery call itself. Only a test has a reason to. */
  discover?: (provider: OidcProvider) => Promise<Configuration>
}

/**
 * Whether this issuer may be talked to over plain http.
 *
 * OpenID Connect is an https protocol and the library refuses anything else by default. A
 * development or test deployment that runs its provider on loopback is the one case worth
 * allowing, and a production deployment never is: there, a plain-http issuer stays refused
 * and the sign-in fails with `provider_error`.
 */
export function allowsInsecureIssuer(issuer: URL, config: DeploymentConfig): boolean {
  return issuer.protocol === 'http:' && !config.isProduction
}

/** Discovers a provider's metadata, authenticating later calls with the client secret. */
async function discoverProvider(
  provider: OidcProvider,
  config: DeploymentConfig,
  logger: FastifyBaseLogger | undefined,
): Promise<Configuration> {
  const issuer = new URL(provider.issuer)
  const insecure = allowsInsecureIssuer(issuer, config)
  if (insecure) {
    logger?.warn(
      { providerId: provider.id, issuer: provider.issuer },
      'talking to the identity provider over plain http; this is only allowed outside production',
    )
  }

  return discovery(issuer, provider.clientId, provider.clientSecret, undefined, {
    ...(insecure ? { execute: [allowInsecureRequests] } : {}),
  })
}

function registerProvider(
  provider: OidcProvider,
  discover: (provider: OidcProvider) => Promise<Configuration>,
): RegisteredProvider {
  let pending: Promise<Configuration> | undefined

  return {
    provider,
    configuration() {
      const started =
        pending ??
        discover(provider).catch((error: unknown) => {
          // A discovery that failed is worth nothing: forget it so the next member to arrive
          // asks the provider again instead of inheriting the failure.
          if (pending === started) pending = undefined
          throw error
        })
      pending = started
      return started
    },
    forget() {
      pending = undefined
    },
  }
}

/** Builds the registry from `OIDC_*` or `OIDC_PROVIDERS_JSON` (spec 02 §1). */
export function createProviderRegistry(
  config: DeploymentConfig,
  options: ProviderRegistryOptions = {},
): ProviderRegistry {
  const discover =
    options.discover ??
    ((provider: OidcProvider) => discoverProvider(provider, config, options.logger))

  const entries = new Map<string, RegisteredProvider>()
  for (const provider of config.oidc.providers) {
    entries.set(provider.id, registerProvider(provider, discover))
  }

  // A copy, so nothing that reads the registry can rearrange the deployment's own list.
  const providers = [...config.oidc.providers]
  const single = entries.size === 1 ? [...entries.values()][0] : undefined

  return {
    providers,
    get: (id) => entries.get(id),
    only: () => single,
  }
}
