# 12. Browser Extension

A small Manifest V3 extension for Chrome (Edge runs the same build) that makes `go/<keyword>` work in the browser with no DNS setup, and puts creating a link one click away from the page it should point at. It has no content scripts, injects nothing into pages, and talks only to the deployment it is configured for.

## 1. What it does

| Feature | Behavior |
|---|---|
| Short-host redirect | A request for `http://<shortHost>/<path>` is redirected to `<baseUrl>/<path>?via=ext` before any DNS lookup, through a declarative net request rule. Typing `go/handbook` in the address bar therefore works on any machine with the extension, wherever it is. Once the deployment also has a DNS record, the rule simply wins first; the destination is the same. |
| Omnibox keyword | The omnibox keyword `go`: typing `go handbook` then Enter navigates to `<baseUrl>/handbook?via=ext`. While typing, suggestions come from `GET /_/api/v1/links/suggestions` (debounced, failures silent, only when signed in); the default suggestion is always "Go to go/<text>". |
| Popup | The action button opens a popup for the current tab. If a link already points at the tab's URL, it shows `go/<keyword>` with Copy. Otherwise it offers to create one: a keyword field (validated with the shared keyword rules), the tab's URL as the destination, Create. Signed out, it shows a Sign in button that opens `<baseUrl>/_/auth/login` in a new tab. |
| Setup | Managed installs get `baseUrl` and `shortHost` from enterprise policy (`storage.managed`) and show no setup at all. Unmanaged installs get an options page asking for the base URL; the extension then reads `shortHost` and the organization title from `GET /_/api/v1/me` after sign-in. |

Out of scope for v1: keyboard shortcuts, reading page content, unfurling `go/` mentions inside pages, any analytics.

## 2. Authentication

The extension borrows the member's existing session. Requests to the API are sent with credentials, and the browser attaches the session cookie for the canonical host because the extension holds host permission for it. The member signs in through the normal page (Okta or whatever the deployment uses); the extension never sees credentials or tokens.

Consequences and requirements:

- The API's Origin check (spec 02 §6) refuses state-changing requests whose `Origin` is not the canonical origin. Extension requests carry `chrome-extension://<id>`. The deployment lists its extension ids in `EXTENSION_ORIGINS`; those origins pass the check. Nothing else about CSRF changes.
- A 401 from the API means "signed out"; the popup shows the sign-in state and never loops.
- The first milestone verifies, in a real browser test, that the session cookie accompanies extension-initiated requests in Chrome. If a browser ever stops sending it, the fallback is a personal API token (spec 02 §9), which is why that door stays open.

## 3. API changes

1. `EXTENSION_ORIGINS` (spec 06 §1): comma-separated extension origins allowed by the Origin check. Default empty.
2. `GET /_/api/v1/links?destination=<url>` (spec 03 §10.1, spec 05): an exact-match filter on the stored destination, so the popup can ask "is there a link for this page" in one request. Ordinary listing rules apply (organization scope, unlisted visibility).
3. `via=ext` is already a recognized visit source (spec 04 §6, spec 07 §2).

No CORS configuration is needed: a browser extension with host permission for the canonical host makes its requests outside the CORS regime.

## 4. Permissions and manifest

| Permission | Why |
|---|---|
| `omnibox` | The `go` keyword |
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess` | The short-host redirect rule, installed dynamically once `baseUrl` and `shortHost` are known |
| `storage` | Managed policy and the options page's values |
| `activeTab` | The popup reads the current tab's URL only while open |
| Host permissions | `http://go/*` is declared as a required host permission, so the redirect for the default short host works the moment the extension is installed, including force-installs, with no click. The canonical origin (for API calls) and any non-default short host are optional host permissions requested from the options page with `permissions.request`, because they are per deployment and enterprise policy cannot grant optional host permissions. |

Managed policy schema (`managed_schema.json`):

```json
{ "type": "object", "properties": { "baseUrl": { "type": "string" }, "shortHost": { "type": "string" } } }
```

Google Workspace or any Chrome Browser Cloud Management can force-install the extension and set that policy; the member sees a working `go/` on first launch. The popup's API calls need one click on the options page to grant the canonical origin, which the extension opens on install.

## 5. Behavior details

- **Redirect rule**: one dynamic rule, `regexFilter: "^http://<shortHost>/(.*)$"`, `regexSubstitution: "<baseUrl>/\\1"`, appending `via=ext` (`?` or `&` as appropriate), resource type `main_frame`. Rebuilt whenever `baseUrl` or `shortHost` changes. Requests to `https://<shortHost>/` are not matched; the service's own bounce handles anything that reaches it.
- **Omnibox input**: the text is trimmed; `go/` or `<shortHost>/` prefixes typed by habit are stripped; spaces are not allowed in a keyword, so input with spaces is sent as typed and the resolver's miss flow handles it. Enter with empty input opens the directory.
- **Suggestions**: at most 5, from the API, shown as `go/<keyword> → <destination host>`; requested no more than every 150 ms.
- **Popup lookup**: `GET /links?destination=<tab url>&limit=1`. Exact match only; a page with a fragment or query differs from one without, on purpose.
- **Popup create**: `POST /links` with `{ keyword, destination }`; `keyword_exists` and `keyword_conflict` show the existing link with Copy; validation errors show inline. After creating, the popup shows the new short form with Copy.
- **Offline or unreachable deployment**: the redirect rule still works (it needs no network beyond the navigation itself); the popup shows "Can't reach <host>".

## 6. Privacy

The extension sends the current tab's URL to the deployment only when the popup is opened, and only to the configured `baseUrl`. It stores `baseUrl`, `shortHost`, and the organization title locally, nothing else, and never reads page content.

## 7. Repository, build, and tests

- Lives in its own repository, `golinks-extension`, so it can be published and versioned independently of the service. It shares nothing at build time: the two API shapes it reads (a link's `id`, `fullPath`, `displayKeyword`, `namespace`, `destination`, and the suggestions list) are declared locally as the extension's own types, and keyword validation is the service's job, reported back through the error envelope (spec 05 §4). Built with esbuild to an unpacked directory and a zip; plain TypeScript, HTML, and CSS, no UI framework.
- Unit tests for omnibox parsing, redirect-rule construction, and URL handling. Browser tests with Playwright loading the unpacked extension into a persistent Chromium context against a running instance of the service (`E2E_BASE_URL`, test sign-in enabled, the extension's id in `EXTENSION_ORIGINS`); the unpacked build pins its id with a `key` in the manifest so that origin is stable across machines: the redirect rule, the omnibox keyword, the popup's lookup and create, and the signed-out state.
- CI builds the zip as an artifact on every push and attaches it to tagged releases.

## 7a. Deployment builds

An organization rolling the extension out builds it for its own service: `BASE_URL=https://links.example.com pnpm build --zip`. The build bakes the address into `deployment.json`, which the extension reads below policy and above the options page, and declares host access to the service and the short host as required permissions, which Chrome grants at install. A force-installed deployment build therefore needs no policy value, no options page, and no click. The generic build (no `BASE_URL`) is what a public listing carries: it takes the address from policy or the options page and asks for host access once.

## 8. Distribution

- **Chrome** (and Edge, which installs Chrome Web Store extensions): publish to the Chrome Web Store as unlisted or private to the organization, so force-install policies can reference the store id. Self-hosted update URLs are a supported alternative for deployments that cannot use the store.
- Version numbers follow the service's releases; the popup shows the extension version.

## 10. Safari, later

Safari can run Manifest V3 web extensions, but three things differ enough that it is a separate, later effort rather than a second build target:

- **Packaging**: a Safari extension ships inside a macOS app built with Xcode and signed with an Apple Developer account, distributed through the App Store or notarized outside it. There is no unpacked-load path for members.
- **Capabilities**: Safari has no `omnibox` API, so the keyword feature does not exist there; the redirect rule and the popup do. Safari has no managed-policy storage for extensions, so configuration is always the options page.
- **Address bar behavior**: whether Safari treats `go/handbook` as a navigation the redirect rule can catch, and whether session cookies accompany extension requests, must be verified in a spike before committing to it.

The redirect rule, popup, and options code are written without Chrome-only APIs where a choice exists, so a Safari build can reuse them.

## 9. Setup guide (for the README)

Managed: force-install the extension and set `baseUrl` (and `shortHost` if not `go`) in the policy. Unmanaged: install, open the options page, enter the base URL, grant the two permissions when asked, sign in once in a tab.
