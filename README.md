# GoLinks

GoLinks is a self-hosted short-link service for organizations. A member types a memorable keyword such as `go/handbook` into the browser and is redirected to the full destination URL. Links belong to an organization and are visible only to its members.

Highlights:

- Fast redirects from a bare short host (`go/...`) with no browser extension required.
- Programmatic links with placeholders: `go/gh/%s` can point at `https://github.com/acme/%s`.
- Namespaces, unlisted links, ownership transfer, and a searchable directory.
- Sign-in through Okta or any OpenID Connect provider; admins can come from IdP groups.
- Postgres for storage, optional Redis for sessions and caches, one container image.

## Repository layout

```
apps/api          Fastify service: redirect resolver, HTTP API, web app host
apps/web          React + Material UI single-page app
packages/shared   zod schemas and pure domain rules used by both
docker            Container init scripts
```

## Requirements

- Node.js 24 or newer (`.nvmrc` pins the version used for development)
- pnpm 10 or newer (`npm install -g pnpm`)
- Docker with Compose, for Postgres and Redis

## Local development

```bash
cp .env.example .env          # local defaults; test sign-in is enabled
docker compose up -d          # Postgres 16 and Redis 7 on localhost
pnpm install
pnpm --filter @golinks/api migrate
pnpm dev                      # API on :3000, web app on :5173 with a proxy to the API
```

Open http://localhost:5173. Health is at http://localhost:3000/_/health/ready.

To sign in locally, print a link and open it in the browser:

```bash
pnpm --filter @golinks/api sign-in-link jane@widgets.test        # an admin, per INITIAL_ADMIN_EMAILS in .env
pnpm --filter @golinks/api sign-in-link sam@widgets.test /handbook   # a member, landing on a keyword
```

Without Docker, `pnpm local` does all of the above in one terminal: it starts an embedded Postgres, the API, and the web app, and prints sign-in links (press Enter for fresh ones). Underneath, `pnpm --filter @golinks/api dev:db` starts the embedded Postgres (the same binaries the integration tests use) with its data under `apps/api/.postgres-embedded`, applies migrations, and prints the `DATABASE_URL` to put in `.env`. Leave `REDIS_URL` unset; sessions then live in Postgres.

Local sign-in uses test mode (`AUTH_TEST_MODE=true` in `.env`), which accepts a short-lived token for any email in `AUTH_TEST_DOMAINS` and never contacts an identity provider. To sign in through a real Okta application instead, set `AUTH_TEST_MODE=false` and configure the `OIDC_*` variables described below.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs the API and the web app in watch mode |
| `pnpm build` | Builds every package (API bundle in `apps/api/dist`, web app in `apps/web/dist`) |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm lint` / `pnpm lint:fix` | Biome lint and format check / auto-fix |
| `pnpm test` | Unit tests in every package |
| `pnpm test:api` | API integration tests against a real Postgres |
| `pnpm --filter @golinks/api migrate` | Applies pending database migrations from `DATABASE_URL` |

Run a single unit test file or name with Vitest's filter: `pnpm --filter @golinks/shared test -- keywords` or `pnpm --filter @golinks/api test -- -t "health"`.

Integration tests start an embedded Postgres automatically. Set `GOLINKS_TEST_DATABASE_URL` to use an existing database instead, which is what CI does with a service container.

## Configuration

Everything is configured with environment variables; `.env.example` lists them all with comments. The essentials:

| Variable | Purpose |
|---|---|
| `BASE_URL` | Canonical origin, for example `https://links.example.com`. Drives cookies, OIDC redirect URIs, and the short-host bounce. |
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Optional. Enables Redis for sessions and caches; recommended with more than one replica. |
| `SESSION_SECRET` | At least 32 random bytes; signs cookies |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | Identity provider. `OIDC_SCOPES`, `OIDC_LABEL`, and `OIDC_ADMIN_GROUPS` are optional. |
| `ORG_RESOLUTION` | `domain` (organization from the email domain, default) or `fixed` with `ORG_FIXED_ID` (everyone shares one organization) |
| `INITIAL_ADMIN_EMAILS` | Comma-separated emails that receive the admin role at sign-in |

### Okta setup

1. In Okta, create an OIDC Web Application integration with the Authorization Code grant.
2. Sign-in redirect URI: `<BASE_URL>/_/auth/callback/<OIDC_ID>`, where `OIDC_ID` is the provider id from your configuration (default `oidc`). Sign-out redirect URI: `<BASE_URL>/`.
3. Set `OIDC_ISSUER` to the org authorization server (`https://acme.okta.com`) or a custom one (`https://acme.okta.com/oauth2/default`), plus the client id and secret.
4. To make members of an Okta group admins, add the `groups` scope (`OIDC_SCOPES=openid email profile groups`), configure a groups claim on the application or authorization server, and set `OIDC_ADMIN_GROUPS=GoLinks Admins`.

### Making `go/` work

Members type `go/keyword`, so the name `go` must reach the service. Any request that arrives with a host other than `BASE_URL` is redirected to the canonical host with the same path, so the short host needs no TLS and no cookies. Point `go` at the service with one of:

- an internal DNS `A` or `CNAME` record for the bare name `go` (recommended for offices and VPN users);
- a hosts-file entry on each machine, for small teams;
- the browser's search-keyword feature: the app exposes an OpenSearch descriptor at `/_/opensearch.xml`, so browsers can add the service as a search engine with the keyword `go`.

The reverse proxy must route both the short host and the canonical host to the service.

## Production

Build the image with `docker build -t golinks .` or pull a published image from the GitHub Container Registry. The container runs the API, serves the web app, and applies migrations on start when `MIGRATE_ON_START=true` (or run `golinks migrate` as a separate deploy step). Postgres is the only stateful dependency; Redis holds sessions and caches and can be flushed at any time.

Logs are structured JSON on stdout with a request id on every line and on every response. Readiness is `/_/health/ready`, liveness `/_/health/live`, and Prometheus metrics are served at `/_/metrics` when `METRICS_ENABLED=true`. Any number of replicas can run once `REDIS_URL` is set; background jobs coordinate through Postgres advisory locks.

`deploy/README.md` is the operator guide, and `deploy/terraform/aws-ecs/` stands the whole stack up on AWS with ECS Fargate, RDS, ElastiCache, and an Application Load Balancer.

## Customizing a deployment

Everything an organization can brand lives in its settings document: title, logo, favicon, colors for the light and dark schemes, banner, navigation links, and the admin list. Admins edit it in the app. A deployment can also fix any of those values from the outside, which is how a container on Kubernetes or ECS comes up already branded, with no one signing in to set it up. The API describes every field at `/_/api/v1/openapi.json`.

### Settings overrides

Give the service a partial settings document and its values win over whatever each organization has stored. There are two sources, and both can be used at once:

- `CONFIG_DIR`: a directory holding `settings.json`. The image sets it to `/app/config`, so a downstream image only has to copy files there.
- `SETTINGS_OVERRIDES_JSON`: the same document inline, for platforms where an environment variable is easier than a file. Its values win over the file's, field by field.

A document that fixes the title, logo, and colors looks like this (the full example is in `examples/config/settings.json`):

```json
{
  "branding": {
    "title": "Acme Links",
    "logoUrl": "/_/branding/logo.svg",
    "primaryColor": "#1f4b99",
    "dark": { "backgroundColor": "#0f1419" }
  },
  "admins": ["ops@acme.example"]
}
```

Fields the deployment fixes show as read-only in the admin screen, and a write that tries to change one is rejected with the field named. Only fields whose change leaves existing links untouched can be fixed this way: `branding`, `banner`, `navigationLinks`, `admins`, `editMode`, `readOnly`, and `keywords.allowedPattern`. The default namespace, the namespace list, punctuation sensitivity, and the resolution mode rewrite or recheck keywords when they change, so they are set by an admin in the app or with the import command below. A document with a field outside that list stops the service at startup with a message saying why.

To set up an organization by script, including the fields above, use the command line inside the container:

```bash
golinks settings export acme.example > settings.json   # the effective document
golinks settings import acme.example settings.json     # same validation and rules as the admin screen
```

### Branding files

Files under `CONFIG_DIR/branding/` are served at `/_/branding/<file>`, so a logo shipped with the deployment is referenced as `/_/branding/logo.svg` in the settings document. Any URL works too; the directory just spares you a separate host for one image.

When the overrides set the title or a scheme's background color, the page served before the app's bundle runs already carries them, so the first paint matches.

### Docker, Kubernetes, and ECS

A downstream image needs one line:

```dockerfile
FROM ghcr.io/containx/golinks:latest
COPY config/ /app/config/
```

On Kubernetes, mount a ConfigMap with `settings.json` at `/app/config` and, if there is a logo, a second one at `/app/config/branding`. On ECS, either bake the directory into the image as above or set `SETTINGS_OVERRIDES_JSON` in the task definition and point `logoUrl` at a URL you host. Either way the overrides are applied on every read, so a change ships with the next deployment and never needs a database migration.

### Customizing a fork

A fork that wants different visual defaults, rather than per-deployment settings, has two files upstream never changes:

- `apps/web/src/branding/overrides.ts`: default light and dark colors, font family names, and the corner radius. Runtime branding from the settings document still wins over these, so an organization can restyle itself without a rebuild.
- `apps/web/src/branding/fonts.ts`: the font packages the app bundles. Swap the imports here and name the families in `overrides.ts`.

Keep everything else in `apps/web/src/app/theme.ts` as it is and merges from upstream stay clean.
