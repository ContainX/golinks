# 10. Testing Strategy

## 1. Layers

| Layer | Scope | Tooling | Runs against |
|---|---|---|---|
| Unit | Pure logic: keyword normalization and canonicalization, allowed-pattern checks, placeholder rules, destination parsing, redirect building, organization resolution from email, settings validation, redirectTo sanitization | Vitest | Nothing external |
| API integration | Every endpoint and the resolver through the HTTP layer, with a real Postgres | Vitest with in-process request injection | Postgres in Docker; Redis optional |
| End-to-end | Real browser flows against the built container | Playwright | Docker compose full profile, test sign-in enabled |

Coverage expectations: unit tests for every rule in specs 03 and 04, including the worked examples table in spec 04 §9 as a parametrized suite; integration tests for every error code in spec 05 §4.

## 2. Test data

- Two organizations, `widgets.test` and `gizmos.test`, are used throughout to prove isolation. Every integration and end-to-end suite includes at least one cross-organization negative test.
- Test sign-in (spec 02 §8) creates members with any email in `AUTH_TEST_DOMAINS`; tests never talk to a real identity provider.
- A separate contract test exercises the OIDC flow against a mock OIDC provider container to cover state, nonce, PKCE, userinfo fallback, `email_verified` handling, group-to-admin mapping, and error redirects.

## 3. Required scenarios

Resolver:

- Unauthenticated request redirects to sign-in and returns to the keyword after sign-in.
- Hit on exact, pattern, hierarchical, and prefix-fallback keywords; case handling; punctuation-insensitive matching; non-ASCII destinations produce ASCII `Location` headers.
- Miss redirects to the pre-filled directory URL with namespace when non-default.
- Short-host bounce preserves path and query.
- Visit counters increment and visit rows are written after a hit; a failure to record does not affect the redirect.

Links:

- Create, list with each filter and sort, paginate, update each field, delete.
- Every conflict case in spec 03 §6.1, in both directions where applicable, plus a concurrency test that two simultaneous creations of the same keyword yield exactly one link.
- Unlisted visibility for owner, admin, and other member across list, search, suggestions, and direct fetch.
- Permission matrix in spec 03 §5, including `editMode` and read-only mode.
- Transfer link lifecycle: create, preview, accept, and each failure code.

Users and admin:

- First sign-in creates organization and user; role from config, from groups, and manual override precedence.
- Disabled user: sign-in rejected, existing session invalidated.
- Settings changes: namespace conflicts, removing a namespace in use, punctuation toggle recomputation and collision, resolution mode switch validation, default namespace change moving links.

Security:

- Origin check rejects cross-site state changes; `SameSite` cookie attributes present; CSP and other headers present; `redirectTo` open-redirect attempts neutralized; non-http(s) destinations rejected.

## 4. Running tests

- `pnpm test` runs unit tests.
- `pnpm test:api` starts Postgres via compose if needed and runs integration tests.
- `pnpm test:e2e` builds the image, starts the full profile, and runs Playwright.
- A single test: `pnpm test -- <pattern>` (Vitest filter) or `pnpm test:e2e -- -g "<title>"` (Playwright).

These commands are the contract for CI (spec 09 §8) and are documented in the repository README once implemented.
