// Reading a member's identity out of what the provider said (spec 02 §2 steps 5 and 7).
//
// A provider tells the service who signed in twice: in the ID token it issued and at the
// userinfo endpoint. Userinfo is the fresher of the two and the one Okta puts `email_verified`
// and group memberships on, so it is read first and the ID token is the fallback — for the
// address, for its verification, and for the groups independently, because a provider may put
// the groups in one place and the address in the other.
//
// Pure: everything is passed in, so the precedence rules are tested without a provider.

/** A claims document, from either source. */
export type Claims = Readonly<Record<string, unknown>>

/** What the two sources together say about the member signing in. */
export interface ProviderIdentity {
  /** The address as the provider spelled it; normalization happens in `completeSignIn`. */
  email: unknown
  /** The `email_verified` claim from whichever source supplied the address, if it carried one. */
  emailVerified: unknown
  /** Which source the address came from, for the log line that explains a refusal. */
  emailSource: 'userinfo' | 'id_token' | 'none'
  /** Group names for the admin mapping of spec 01 §2.3. */
  groups: string[]
  /** Which source the groups came from, or `none` when neither asserted any. */
  groupsSource: 'userinfo' | 'id_token' | 'none'
}

/** An address is usable when it is a non-blank string; anything else is no address at all. */
function hasEmail(claims: Claims | undefined): boolean {
  return typeof claims?.email === 'string' && claims.email.trim().length > 0
}

/**
 * Group names as a provider may spell them: a list, or one comma-separated string. Anything
 * else asserts no groups.
 */
export function readGroupClaim(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((group) => group.trim())
      .filter((group) => group.length > 0)
  }
  if (!Array.isArray(value)) return undefined
  return value
    .filter((group): group is string => typeof group === 'string')
    .map((group) => group.trim())
    .filter((group) => group.length > 0)
}

/**
 * Combines the two sources into the identity `completeSignIn` is handed.
 *
 * `userInfo` is undefined when the userinfo request failed; the ID token then answers for
 * everything, which is what keeps a sign-in working through a provider whose userinfo endpoint
 * is briefly unavailable.
 */
export function identityFromClaims(
  userInfo: Claims | undefined,
  idToken: Claims | undefined,
): ProviderIdentity {
  const emailSource = hasEmail(userInfo) ? 'userinfo' : hasEmail(idToken) ? 'id_token' : 'none'
  const emailClaims =
    emailSource === 'userinfo' ? userInfo : emailSource === 'id_token' ? idToken : undefined

  const fromUserInfo = readGroupClaim(userInfo?.groups)
  const fromIdToken = readGroupClaim(idToken?.groups)
  const groups = fromUserInfo ?? fromIdToken
  const groupsSource =
    fromUserInfo !== undefined ? 'userinfo' : fromIdToken !== undefined ? 'id_token' : 'none'

  return {
    email: emailClaims?.email,
    emailVerified: emailClaims?.email_verified,
    emailSource,
    groups: groups ?? [],
    groupsSource,
  }
}
