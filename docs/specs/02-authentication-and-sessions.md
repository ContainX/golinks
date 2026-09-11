# 02. Authentication and Sessions

## 1. Identity providers

Sign-in is OpenID Connect only. Okta is the primary target; any compliant provider works. One or more providers may be configured. Each provider has:

| Field | Notes |
|---|---|
| id | Short slug used in URLs, for example `okta` |
| label | Button text, for example `Sign in with Okta` |
| issuer | Base URL. Endpoints and keys come from `<issuer>/.well-known/openid-configuration`. |
| clientId, clientSecret | Confidential client credentials |
| scopes | Default `openid email profile`. Add `groups` for Okta group-based admin mapping. |
| adminGroups | Optional list of group names whose members become admins (spec 01 §2.3) |
| iconUrl | Optional |

A single provider is configured with `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_SCOPES`, `OIDC_LABEL`, `OIDC_ADMIN_GROUPS`. Multiple providers are configured with `OIDC_PROVIDERS_JSON`, a JSON array of the fields above. If both are set, the JSON wins.

The service MUST refuse to start if no provider is configured, unless test sign-in (§8) is enabled.

### 1.1 Okta setup notes

- Create an OIDC "Web Application" integration. Grant type: Authorization Code. PKCE is used in addition to the client secret.
- Sign-in redirect URI: `<BASE_URL>/_/auth/callback/<providerId>`.
- Sign-out redirect URI: `<BASE_URL>/`.
- Issuer is either the org authorization server (`https://acme.okta.com`) or a custom authorization server (`https://acme.okta.com/oauth2/default`). Group claims on the org server require a `groups` claim filter on the app; custom servers need the claim added to the ID token or userinfo. Either way the service reads `groups` from userinfo first and the ID token second.
- Okta returns `email_verified` in userinfo. The service honors it when present (§2 step 5).

## 2. Sign-in flow

All auth routes live under `/_/auth`.

1. `GET /_/auth/login?redirectTo=<path>&error=<code>`
   - If the request already carries a valid session, redirect to the sanitized `redirectTo` or `/`.
   - If exactly one provider is configured and there is no `error`, redirect straight to `/_/auth/start/<providerId>` with the same `redirectTo`.
   - Otherwise redirect to the web app's sign-in page at `/_/login`, carrying the same `redirectTo` and `error` query parameters. That page reads `GET /_/auth/providers` to list the providers (id, label, icon) and shows the message for `error` (see §2.1 for codes).
2. `GET /_/auth/start/<providerId>?redirectTo=<path>`
   - Generate `state`, `nonce`, and a PKCE verifier. Store them with the sanitized `redirectTo` in a short-lived (10 minute) signed, HttpOnly cookie named `gl_login`.
   - Redirect to the provider's authorization endpoint with `response_type=code`, the configured scopes, `state`, `nonce`, `code_challenge` (S256), and the callback URL.
3. `GET /_/auth/callback/<providerId>?code=&state=`
   - Reject when the `gl_login` cookie is missing or `state` differs: error `login_state_mismatch`.
   - Exchange the code using the PKCE verifier and client secret. Validate the ID token: issuer, audience, signature against the discovered JWKS, expiry, and `nonce`.
   - Fetch userinfo. The email is `userinfo.email`, falling back to the ID token's `email` claim. Missing email: error `email_missing`.
   - If an `email_verified` claim is present on the source that supplied the email and is false (boolean or the strings `false`, `0`, `no`), reject with `email_unverified`. An absent claim is accepted.
   - Normalize the email: trim, lowercase.
   - Resolve the organization (spec 01 §1.2). Apply `ORG_ALLOWED_IDS`.
   - Upsert the user. Reject disabled users with `account_disabled`. Recompute the role (spec 01 §2.3) using the `groups` claim from userinfo, then the ID token.
   - Set `last_login_at`. Create a session (§3). Clear `gl_login`. Redirect to `redirectTo`.
4. On any provider error (including the user declining consent), redirect to `/_/auth/login?error=<code>`. Never expose provider error details to the browser; log them with a request id.

### 2.1 Error codes shown on the sign-in page

| Code | Message |
|---|---|
| account_disabled | Your account has been disabled by an administrator. |
| org_not_allowed | Your organization is not allowed to use this service. |
| email_missing | The identity provider did not return an email address. |
| email_unverified | Your email address is not verified with the identity provider. |
| login_state_mismatch | The sign-in attempt expired or was tampered with. Please try again. |
| provider_error | Sign-in failed. Please try again. |

### 2.2 redirectTo sanitization

`redirectTo` MUST be a relative path: it starts with a single `/`, does not start with `//` or `/\`, and contains no scheme. Anything else is replaced with `/`. This prevents open redirects. The resolver relies on this to send a member back to `go/<keyword>` after sign-in.

## 3. Sessions

- Sessions are server-side. The store is Redis when `REDIS_URL` is set, otherwise the Postgres table `sessions` (id, user_id, data jsonb, created_at, last_seen_at, expires_at). Redis is recommended whenever more than one API replica runs.
- The session id is 32 random bytes, base64url encoded. The cookie carries only the id, signed with `SESSION_SECRET`.
- Cookie attributes: name `gl_session`, `HttpOnly`, `Secure` (omitted only when `BASE_URL` is `http://localhost...`), `SameSite=Lax`, `Path=/`, no `Domain` (host-only). `SameSite=Lax` is required so that top-level navigations to `go/<keyword>` carry the cookie.
- Lifetime: absolute maximum `SESSION_MAX_AGE` (default 30 days) measured from sign-in. Optional idle timeout `SESSION_IDLE_TIMEOUT` (default off). The cookie's expiry slides on each request up to the absolute maximum.
- Session data: `userId`, `providerId`, `createdAt`, `lastSeenAt`, and, when `OIDC_LOGOUT_AT_IDP` is on, the `idToken` needed for RP-initiated logout.
- Every authenticated request loads the session, then the user. If the user is missing or disabled, the session is destroyed and the request is treated as unauthenticated.
- The user lookup MAY be cached for up to 60 seconds. A disable therefore takes effect within a minute at most.

## 4. Sign-out

`POST /_/auth/logout` destroys the session, clears the cookie, and redirects to the web app's sign-in page, `/_/login?signedOut=1`. `GET` is also accepted for plain links but is subject to the same Origin check as other state-changing requests (§6).

When `OIDC_LOGOUT_AT_IDP=true` and the provider advertises `end_session_endpoint`, the service redirects there with `id_token_hint` and `post_logout_redirect_uri=<BASE_URL>/` instead of redirecting locally.

## 5. Request authorization

| Surface | Unauthenticated | Member | Admin |
|---|---|---|---|
| Resolver `GET /<path>` | 302 to `/_/auth/login?redirectTo=<path>` | Resolves | Resolves |
| API `/_/api/v1/*` | 401 JSON | Per spec 03 permissions | All |
| API `/_/api/v1/admin/*` | 401 JSON | 403 JSON | All |
| Web app shell and assets | Served | Served | Served |
| Health endpoints | Served | Served | Served |

## 6. CSRF protection

For every request with method POST, PUT, PATCH, or DELETE under `/_/api` and `/_/auth/logout`:

- The `Origin` header MUST be present and MUST equal the origin of `BASE_URL`, or one of the extension origins listed in `EXTENSION_ORIGINS` (spec 12). If `Origin` is absent, the `Referer` origin is checked instead. Otherwise respond 403 `csrf_origin_mismatch`.
- The `Content-Type` of API requests with a body MUST be `application/json`; otherwise 415.

Together with `SameSite=Lax` cookies and JSON-only bodies this removes the need for a CSRF token.

## 7. Security headers

Applied to every response unless noted:

- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`. Inline styles are allowed because the UI library injects styles at runtime; scripts stay strict. Organization branding images (spec 06) are why `img-src` allows `https:`.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` when `BASE_URL` is https.
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin`, except redirect responses from the resolver, which use `no-referrer` so the keyword is not leaked to destinations.
- Resolver redirects also carry `Cache-Control: no-store`.

## 8. Test sign-in

For automated tests only.

- Enabled only when `AUTH_TEST_MODE=true` and `AUTH_TEST_SECRET` is set. The service MUST refuse to start when test mode is on and `NODE_ENV=production`.
- `POST /_/auth/test-login` accepts a JSON body `{ "token": "<jwt>" }`. The JWT is HS256-signed with `AUTH_TEST_SECRET`, carries `email` and `exp` (at most 5 minutes ahead), and optionally `groups`.
- The email's domain MUST be in `AUTH_TEST_DOMAINS`.
- The endpoint runs the same organization resolution, upsert, role computation, and session creation as a real sign-in, then responds 204 with the session cookie set. Tests may also call `GET /_/auth/test-login?token=` to receive a redirect, which is convenient for browser tests.

## 9. Personal API tokens

Not in v1. Listed here so that the session design does not preclude adding a bearer-token path for a CLI or browser extension later.
