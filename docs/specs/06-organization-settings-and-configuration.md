# 06. Organization Settings and Configuration

Two layers of configuration exist:

- Deployment configuration: environment variables read at startup. Infrastructure, secrets, identity provider, and organization resolution.
- Organization settings: a JSON document per organization, stored in `organizations.settings`, edited by admins through the API and web app.

## 1. Deployment configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| BASE_URL | yes | | Canonical origin, for example `https://links.example.com`. Drives cookies, redirect URIs, and the short-host bounce. |
| SHORT_HOST | no | `go` | Hostname members type. Informational (shown in the UI and OpenSearch descriptor); the bounce works for any non-canonical host. |
| DATABASE_URL | yes | | Postgres connection string |
| REDIS_URL | no | | Enables Redis for sessions and caches |
| SESSION_SECRET | yes | | At least 32 bytes; signs the session and login cookies |
| SESSION_MAX_AGE | no | `30d` | Absolute session lifetime |
| SESSION_IDLE_TIMEOUT | no | off | Idle expiry |
| OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET | yes* | | Single provider. *Not required when `OIDC_PROVIDERS_JSON` is set or test mode is on. |
| OIDC_SCOPES | no | `openid email profile` | |
| OIDC_LABEL | no | `Sign in` | |
| OIDC_ADMIN_GROUPS | no | | Comma-separated group names |
| OIDC_PROVIDERS_JSON | no | | JSON array of providers (spec 02 §1) |
| OIDC_LOGOUT_AT_IDP | no | `false` | RP-initiated logout |
| ORG_RESOLUTION | no | `domain` | `domain` or `fixed` |
| ORG_FIXED_ID | when fixed | | |
| ORG_DOMAIN_ALIASES | no | | `a=b,c=d` |
| ORG_ALLOWED_IDS | no | | Comma-separated allowlist |
| INITIAL_ADMIN_EMAILS | no | | Comma-separated |
| TRANSFER_TOKEN_TTL | no | `24h` | |
| SUGGESTION_MIN_SIMILARITY | no | `0.3` | |
| VISIT_RETENTION_DAYS | no | `365` | Spec 07 |
| TRUST_PROXY | no | `false` | Honor `X-Forwarded-*` from a reverse proxy |
| EXTENSION_ORIGINS | no | | Comma-separated extension origins (`chrome-extension://<id>`) the Origin check accepts (spec 12) |
| RATE_LIMIT_* | no | Spec 05 §5 | |
| AUTH_TEST_MODE, AUTH_TEST_SECRET, AUTH_TEST_DOMAINS | no | off | Spec 02 §8 |
| LOG_LEVEL | no | `info` | |
| PORT | no | `3000` | |
| CONFIG_DIR | no | | Directory holding the deployment's own configuration: `settings.json` (§6) and `branding/`, whose files are served at `/_/branding` |
| SETTINGS_OVERRIDES_JSON | no | | The same settings document inline, as JSON. Wins field by field over `settings.json` (§6) |

Durations accept `30d`, `12h`, `15m`, `90s`. The service validates all variables at startup with the shared zod schema and exits with a clear message on any problem.

## 2. Organization settings

Stored as one JSON document, validated on write against the schema below. Missing fields take defaults, so a document of `{}` is valid.

```jsonc
{
  "defaultNamespace": "go",           // 1-30 chars, matches ^[a-z0-9-]+$
  "namespaces": ["eng", "docs"],      // each like defaultNamespace, distinct, not equal to defaultNamespace
  "keywords": {
    "allowedPattern": "^[a-z0-9-]+(/([a-z0-9-]+|%s))*$",  // must compile; invariants in spec 03 §2.3 always apply
    "punctuationSensitive": true,
    "resolutionMode": "standard"      // "standard" | "prefixFallback"
  },
  "editMode": "ownersAndAdmins",      // "ownersAndAdmins" | "anyMember" (destination edits only)
  "readOnly": false,
  "admins": ["ops@acme.com"],         // emails that receive the admin role at sign-in (spec 01 §2.3)
  "banner": {                         // null to hide
    "text": "Migration to the new wiki finishes Friday.",
    "url": "https://wiki.acme.com/migration",
    "level": "info"                   // "info" | "warning"
  },
  "branding": {
    "title": "Acme GoLinks",          // page title and header
    "logoUrl": "https://static.acme.com/logo.svg",
    "faviconUrl": null,
    "primaryColor": "#1f4b99",        // #rrggbb, both color schemes
    "secondaryColor": "#d97706",
    "light": {                        // the light scheme alone; each field null to fall back
      "primaryColor": null,
      "secondaryColor": null,
      "backgroundColor": "#f6f7fb",   // the page ground
      "surfaceColor": "#ffffff"       // cards, tables, and dialogs
    },
    "dark": {                         // the dark scheme alone, same four fields
      "primaryColor": null,
      "secondaryColor": null,
      "backgroundColor": "#0b1020",
      "surfaceColor": "#131a2e"
    }
  },
  "navigationLinks": [                // shown in the header and menu; admin-only entries marked
    { "text": "Docs", "url": "https://wiki.acme.com/golinks", "adminOnly": false },
    { "text": "Admin console", "url": "/_/admin", "adminOnly": true }
  ]
}
```

A color is resolved in one order: the scheme's own value (`branding.light.primaryColor`), then the scheme-independent one (`branding.primaryColor`), then the app's own palette. A scheme block left at its defaults therefore changes nothing.

Rules:

- `namespaces` changes are checked for conflicts with existing keywords (spec 03 §2.5). Removing a namespace that still has links is rejected with `namespace_in_use` listing counts; links must be moved or deleted first.
- Toggling `punctuationSensitive` from true to false recomputes the canonical keyword of every link in the organization inside the same transaction and fails with `keyword_conflict` listing the pairs if two links collapse to the same canonical form. Toggling from false to true sets each canonical keyword back to its display keyword.
- Switching `resolutionMode` to `prefixFallback` is rejected with `keyword_conflict` if any existing keyword violates the mode's placeholder rule (spec 03 §2.4) or the mode's prefix conflict rule (spec 03 §6.1 item 4).
- `allowedPattern` changes apply to new and renamed keywords only; existing keywords are not revalidated.

## 3. Changing the default namespace

`PUT /admin/settings` with a new `defaultNamespace`:

1. The new name MUST NOT be in `namespaces`.
2. In one transaction, update `links.namespace` from the old default to the new default for the organization, then save the settings.
3. Emit `organization.settings_updated`.

Links continue to resolve under the new default immediately. The old default name becomes an ordinary keyword prefix again.

## 4. Caching and propagation

Settings are read on every resolver and API request. They are cached in-process for 30 seconds and in Redis for 5 minutes when configured, keyed by organization id, and invalidated on write. A change is therefore visible within 30 seconds on every replica and immediately on the replica that made it.

## 5. Seeding

`INITIAL_ADMIN_EMAILS` and the provider's admin groups are the only deployment-level inputs into the settings an organization starts with. Everything else is edited by admins after first sign-in, fixed by the deployment (§6), or set from the command line:

| Command | Effect |
|---|---|
| `golinks settings import <organization-id> <file.json>` | Applies a settings document: the same validation, transaction, and `organization.settings_updated` event as `PUT /admin/settings`. An organization nobody has signed in to yet is created first. A document that changes a managed value (§6) is refused, one field problem per line, with exit code 1. |
| `golinks settings export <organization-id>` | Prints the effective settings document as JSON on stdout: what a member's request reads, deployment overrides applied. |

Both commands read `DATABASE_URL` and the overrides of §6 the same way the service does, so an exported document can be edited and imported into another environment.

## 6. Deployment overrides

A deployment MAY fix part of the settings document for every organization, without an admin editing anything. Two sources, both optional:

| Source | Read from |
|---|---|
| `<CONFIG_DIR>/settings.json` | A file in the deployment's configuration directory: a `COPY config/ /app/config/` in a downstream image, or a mounted ConfigMap. A missing or empty file supplies nothing. |
| `SETTINGS_OVERRIDES_JSON` | The same document as an environment variable. |

Merging is field by field, with the inline document laid over the file's: nested objects merge (`branding.light.backgroundColor` from one and `branding.title` from the other both survive), while lists and `banner` are replaced as a whole. The merged document is validated at startup, and a problem stops the process with one line per field rather than being ignored.

Only settings whose change leaves stored links untouched may be fixed this way:

| Setting | May a deployment fix it? |
|---|---|
| `editMode`, `readOnly`, `admins`, `banner`, `navigationLinks` | Yes |
| `branding.*`, including the `light` and `dark` blocks | Yes |
| `keywords.allowedPattern` | Yes: it applies to new and renamed keywords only (§2) |
| `defaultNamespace` | No: changing it renames the namespace of every link |
| `namespaces` | No: it is checked against existing links |
| `keywords.punctuationSensitive` | No: changing it recomputes the canonical keyword of every link |
| `keywords.resolutionMode` | No: it is checked against existing keywords |

The four refused settings rewrite or revalidate keywords inside the transaction that stores them (§2, §3), which nothing outside the database can do. They are set through `PUT /admin/settings` or `golinks settings import`.

Effect on the rest of the service:

- **Reads.** Every settings read answers with the deployment's values laid over the organization's stored document. The overrides are applied once, as a document enters the in-process cache of §4, so a cache hit stays a lookup.
- **Reporting.** `GET /me` returns the dotted paths the deployment fixes as `app.managedSettings` (spec 05 §2.2), sorted, so the admin screen shows those fields as read-only.
- **Writes.** `PUT /admin/settings` and `golinks settings import` refuse a document that changes a managed value, with `validation_failed` and one message per path, before anything is written. A document that leaves the managed values alone is stored normally.
- **Branding files.** Files under `<CONFIG_DIR>/branding` are served at `/_/branding/<file>`, public and cached for an hour, with no directory listing and no dotfiles. `branding.logoUrl` and `branding.faviconUrl` may therefore point at `/_/branding/logo.svg` instead of at a host every member's browser has to reach.
- **First paint.** When the deployment fixes `branding.title`, `branding.light.backgroundColor`, or `branding.dark.backgroundColor`, the `index.html` served for `/` and for client-side routes carries them: the title is replaced and the ground colors are appended to the shell's own rules. The file is read once at startup and served as one transformed string, so the first paint matches the deployment before any script has run. A deployment that fixes none of the three is served the built file unchanged.
