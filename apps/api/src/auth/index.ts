// Barrel for the "auth" module. Export public symbols from here only.

export type { SignInErrorCode, SignInErrorOptions } from './errors.ts'
export {
  isSignInError,
  isSignInErrorCode,
  SIGN_IN_ERROR_CODES,
  SIGN_IN_ERROR_MESSAGES,
  SignInError,
} from './errors.ts'
export { isAdmin, requireAdmin, requireMember } from './guards.ts'
export type { MemberCache, MemberCacheOptions } from './member-cache.ts'
export {
  attachMemberCache,
  createMemberCache,
  DEFAULT_MEMBER_CACHE_TTL_MS,
  memberCacheOf,
} from './member-cache.ts'
export type {
  LiveSession,
  MemberResolution,
  MemberResolverOptions,
  SessionRevocationReason,
} from './member-resolver.ts'
export {
  createMemberResolution,
  markSessionRevoked,
  sessionOf,
  sessionRevocationOf,
  signedInSessionId,
} from './member-resolver.ts'
export type { Claims, ProviderIdentity } from './oidc/claims.ts'
export { identityFromClaims, readGroupClaim } from './oidc/claims.ts'
export type { LoginAttempt } from './oidc/login-cookie.ts'
export {
  clearLoginAttempt,
  decodeLoginAttempt,
  encodeLoginAttempt,
  LOGIN_COOKIE_MAX_AGE_MS,
  LOGIN_COOKIE_NAME,
  LOGIN_COOKIE_PATH,
  readLoginAttempt,
  writeLoginAttempt,
} from './oidc/login-cookie.ts'
export type {
  ProviderRegistry,
  ProviderRegistryOptions,
  RegisteredProvider,
} from './oidc/registry.ts'
export { allowsInsecureIssuer, createProviderRegistry } from './oidc/registry.ts'
export type { OidcRouteOptions } from './oidc/routes.ts'
export {
  AUTH_CALLBACK_PATH,
  AUTH_LOGIN_PATH,
  AUTH_START_PATH,
  callbackUri,
  registerOidcRoutes,
  startPath,
} from './oidc/routes.ts'
export type { IdentityOptions } from './plugin.ts'
export { createIdentityPlugin, redirectsRevokedSession } from './plugin.ts'
export {
  DEFAULT_REDIRECT_TO,
  SIGN_IN_PAGE_PATH,
  SIGN_IN_PATH,
  sanitizeRedirectTo,
  signInPageLocation,
  signInPathWithError,
} from './redirect-to.ts'
export type { RoleDecision, RoleInputs } from './roles.ts'
export { computeRole, isConfiguredAdmin, isGroupAdmin } from './roles.ts'
export type {
  PostgresSessionStore,
  SessionLifetime,
  SessionRedisClient,
  SessionStoreDependencies,
  SessionStoreOptions,
} from './session-stores.ts'
export {
  absoluteExpiryOf,
  createConfiguredSessionStore,
  createPostgresSessionStore,
  createRedisSessionStore,
  fromSessionRecord,
  isSessionExpired,
  SESSION_KEY_PREFIX,
  sessionLifetimeOf,
  toSessionRecord,
} from './session-stores.ts'
export type { CompleteSignInOptions, SignInIdentity, SignInOutcome } from './sign-in.ts'
export { completeSignIn, isEmailUnverified, normalizeSignInEmail } from './sign-in.ts'
export { registerSignOutRoutes, SIGN_OUT_PATH, SIGNED_OUT_PATH } from './sign-out.ts'
export type { TestLoginClaims, TestLoginRouteOptions } from './test-login.ts'
export {
  MAX_TEST_TOKEN_LIFETIME_MS,
  registerTestLoginRoutes,
  TEST_LOGIN_PATH,
  TEST_PROVIDER_ID,
  verifyTestLoginToken,
} from './test-login.ts'
