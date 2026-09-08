# @golinks/web

The GoLinks web application: a React single-page app built with Vite and
Material UI, talking to the API over the JSON HTTP interface in
`docs/specs/05-http-api.md`.

Screens are placeholders. UX design is a separate step (`docs/specs/08-web-app-features.md` §9),
and nothing in `src/pages/` should be read as a proposal for layout, navigation,
or visual design. What is real is the scaffolding: the theme, the API cache, the
transport, and the route table.

## Route ownership

`docs/specs/04-resolution-and-redirect.md` §1 divides every path in the product
between three owners, and the router here is built around that division:

| Path | Owner | In this app |
|---|---|---|
| `/` | Web app | The directory route |
| `/_/**` | Web app, API, auth, assets, health | Client routes plus the server-owned prefixes below |
| `/favicon.ico`, `/robots.txt` | Static files | Not routed here |
| Everything else | Resolver | **Never a client route** |

Every path that is not `/` and does not start with `/_/` is a potential keyword.
`go/handbook` arrives as `GET /handbook`, and the server answers it with a 302 to
the destination. If the client router claimed those paths — with a top-level
`path: '*'`, say — a client-side navigation to `/handbook` would render the app
instead of resolving the keyword, and the product's core behavior would only work
on a cold page load. So `src/app/routes.tsx` has no root-level catch-all, and its
only splat route is scoped under `/_/`. Leaving the app for a keyword is a full
page load, deliberately, so the request reaches the server that owns it.

Within `/_/`, some prefixes belong to the API and are likewise absent from the
route table:

| Prefix | Served by |
|---|---|
| `/_/api/**` | The JSON API (spec 05) |
| `/_/auth/**` | Sign-in, callback, and sign-out (spec 02 §2) |
| `/_/health` | Health checks |
| `/_/opensearch.xml` | The keyword search template (spec 11) |
| `/_/assets/**` | The built JavaScript and CSS |

The client routes are:

| Route | Screen |
|---|---|
| `/` | Directory |
| `/_/` | Directory, where a resolver miss lands with `?keyword=` and `?namespace=` (spec 04 §8) |
| `/_/login` | Sign-in: provider chooser, `?error=<code>` from spec 02 §2.1, `?signedOut=1` after sign-out |
| `/_/transfer/:token` | Ownership transfer preview (spec 08 §6) |
| `/_/admin` | Administration entry point |
| `/_/admin/users` | User administration |
| `/_/admin/settings` | Organization settings |
| `/_/admin/events` | Audit trail |
| `/_/*` | Not found — scoped to `/_/` so keyword paths stay with the resolver |

Sign-in is reached by leaving the app: `apiFetch` answers a 401 by sending the
browser to `/_/auth/login?redirectTo=<current path and query>`, which is an API
endpoint, not a client route. That endpoint either bounces straight to the single
configured provider or hands the browser to the sign-in screen at `/_/login`.

## Development

```
pnpm --filter @golinks/web dev
```

Vite serves the app on port 5173 and forwards `/_/api`, `/_/auth`, `/_/health`,
and `/_/opensearch.xml` to the API on `http://localhost:3000` (override with
`API_ORIGIN`). Everything else falls back to `index.html`, which is what makes a
cold request for `/_/login` or `/_/admin/users` load the app rather than 404.

The resolver is not proxied. A keyword typed against the dev server is not
resolved by it; exercise resolution against the API directly.

## Production

`pnpm --filter @golinks/web build` emits `dist/`. The API serves that build: the
hashed assets under `/_/assets/`, and `index.html` for `/` and `/_/**` only.
Serving `index.html` more widely would break resolution, since a keyword request
must reach the resolver rather than the app. There is no separate web container.

## Data access

Every request goes through `src/api/`. `http.ts` is the transport; beside it,
one module per resource turns the endpoint table of spec 05 §3 into functions.
Those functions are the only place the wire format is known:

- request parameters are checked against the endpoint's shared query schema and
  serialized from it, so a filter the API would refuse never leaves the browser
  and a misspelled one is a rejection rather than a silently ignored key;
- responses are parsed with the shared response schema, so a payload that does
  not match the contract raises `ResponseValidationError` naming the resource
  instead of spreading `undefined` through the app;
- a refusal arrives as `ApiError` carrying the code from spec 05 §4. Read it
  with `isApiErrorCode(error, 'keyword_exists')`; a keyword collision carries
  the link it collided with, already parsed, in `existingLink`.

`src/queries/` wraps those functions in React Query hooks and nothing else — no
formatting, no screen logic. Keys come from the factory in `queries/keys.ts` and
nest from the general to the specific, so that invalidating `links.lists()`
reaches every page of every filter. Listings are infinite queries over the
cursors the API hands back (spec 03 §10.1); the caller asks for another page
without knowing what a cursor is.

## Branding

An organization's branding (spec 06 §2) arrives on `/me` and is applied at
runtime, never built in: `BrandingProvider` derives the Material UI theme, the
document title, and the favicon from it, and hands the branding itself to
components through `useBranding()` for the logo. Until `/me` answers — and for a
member with no session, who is on their way to sign-in — the app renders in the
stock palette under the title `index.html` was served with, with no error shown.
An admin who changes the primary color changes what every member sees on the
next read of `/me`, with no rebuild.

## Layout

```
src/
  api/                    The JSON API (spec 05)
    http.ts               Transport: apiFetch, ApiError, the 401 redirect
    resource.ts           Query building and response parsing, from the shared schemas
    errors.ts             Reading a failure: isApiErrorCode, existingLink, validationFields
    me.ts                 /me
    links.ts              /links, /links/suggestions, /links/:id/transfers
    transfers.ts          /transfers/:token
    admin.ts              /admin/users, /admin/settings, /admin/events
  queries/                React Query hooks over the resource modules
    keys.ts               The cache's key layout
    me.ts links.ts transfers.ts admin.ts
  app/                    Application shell
    AppProviders.tsx      The API cache, then the branding that depends on it
    BrandingProvider.tsx  Theme, title, favicon, and branding context from /me
    documentBranding.ts   The title and favicon, which live outside React
    AppShell.tsx          Root layout; chrome is deferred to the UX design step
    routes.tsx            The route table above
    router.ts             Browser router over the route table
    theme.ts              createAppTheme(branding) from spec 06 §2 branding
    queryClient.ts        Cache defaults
  pages/                  Placeholder screens, one heading and one sentence each
  test/                   Vitest setup, resource fixtures, fetch and cache harnesses
```

## Checks

```
pnpm --filter @golinks/web typecheck
pnpm --filter @golinks/web test
pnpm --filter @golinks/web build
```
