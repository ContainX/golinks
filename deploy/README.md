# Deploying GoLinks

This guide is for whoever stands the service up and keeps it running. It describes what runs, what it needs from the platform around it, and the handful of operations that come up after the first deploy. Reference infrastructure for AWS lives in `terraform/aws-ecs/`; the guide is written so that any platform can follow it, and `REQUIREMENTS.md` states, component by component, what any implementation must provide, for organizations that build with their own modules.

## What runs

One container image runs everything: the resolver that answers `go/<keyword>`, the JSON API, the web app's static files, and the background jobs. There is no separate worker and no separate front-end server.

It needs:

- **PostgreSQL 16 or newer.** The only stateful store. The first migration installs the `pg_trgm` and `citext` extensions, which are trusted extensions since PostgreSQL 13, so the application role needs `CREATE` on the database and nothing more. Managed services such as RDS work with the ordinary master user.
- **Redis 7 or newer, optional.** Holds sessions, caches, and rate-limit counters. One replica of the service runs fine without it. More than one replica needs it, because sessions must be visible to every replica. It may be flushed at any time; members sign in again.
- **Egress** to the image registry, to the identity provider, and to nothing else. The service makes no other outbound calls.

Background jobs (visit retention, session sweeping) run inside the serving process and take a Postgres advisory lock, so several replicas never do the same housekeeping twice.

## Topology

```
members' browsers
   │  https://links.example.com          (canonical host, TLS at the load balancer)
   │  http://go/<keyword>                 (short host, plain HTTP)
   ▼
load balancer ──────────────► service tasks (port 3000) ──► PostgreSQL
                                         │
                                         └─► Redis (optional)
```

Two names reach the same service. The canonical host is where members use the app and where cookies live. The short host is what they type. Any request whose `Host` is not the canonical one is redirected by the service to the same path on the canonical origin, so the short host needs no certificate and no cookies: the load balancer just forwards it. That redirect is the only thing ever served over plain HTTP; the app, the API, sign-in, and the session cookie exist only on the canonical host over HTTPS. Members' machines have to resolve the bare name `go`, which is a DNS matter inside the organization's network and is covered under **Making `go/` resolve** below.

## Before the first deploy

1. **Choose the canonical origin** and obtain a certificate for it. This is `BASE_URL`, for example `https://links.example.com`. Everything else derives from it: cookie scope, the sign-in redirect URI, the short-host redirect.
2. **Register the identity provider application.** For Okta, an OIDC Web Application with the Authorization Code grant. Sign-in redirect URI: `<BASE_URL>/_/auth/callback/oidc`. Sign-out redirect URI: `<BASE_URL>/`. Keep the client id and secret for the configuration. To make an Okta group admins, add the `groups` scope, expose a groups claim on the application, and set `OIDC_ADMIN_GROUPS` to the group name.
3. **Decide how organizations are resolved.** `ORG_RESOLUTION=domain` (the default) gives each email domain its own organization; `ORG_RESOLUTION=fixed` with `ORG_FIXED_ID` puts everyone in one. Most single-company deployments want `fixed`.
4. **Name the first admins** in `INITIAL_ADMIN_EMAILS`, or rely on the provider's admin group.
5. **Provide a database and, if needed, Redis**, reachable only from the service.
6. **Plan the `go` DNS record** in whatever serves the organization's clients.

## Configuration

Everything is an environment variable; `.env.example` at the repository root documents each one with its default. The ones every production deployment sets:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` (the image sets it) |
| `BASE_URL` | the canonical origin |
| `TRUST_PROXY` | `true` behind any load balancer, so the service reads the forwarded protocol, host, and client address from it |
| `DATABASE_URL` | `postgres://user:password@host:5432/golinks?sslmode=require`; managed services such as RDS refuse plaintext connections, and the client reads `sslmode` from the URL |
| `REDIS_URL` | `redis://host:6379`, or `rediss://` for TLS; leave unset for a single replica without Redis |
| `SESSION_SECRET` | at least 32 random bytes; rotating it signs everyone out |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | from the identity provider |
| `ORG_RESOLUTION`, `ORG_FIXED_ID` | see above |
| `INITIAL_ADMIN_EMAILS` | comma-separated |
| `EXTENSION_ORIGINS` | `chrome-extension://<id>` of the browser extension, when it is rolled out |
| `MIGRATE_ON_START` | `false`; run migrations as a deploy step (next section) |

Secrets belong in the platform's secret store, never in the image. The service logs its effective configuration at startup with every secret redacted, which is the first thing to read when a deployment misbehaves. A variable that does not validate stops the process with one line per problem.

Never set `AUTH_TEST_MODE` in production; the service refuses to start with it under `NODE_ENV=production`.

## Migrations

Migrations live in the image and are applied with:

```bash
node apps/api/dist/cli.js migrate
```

Run it once before the first start and again before any release whose notes mention a migration, as a one-off task using the same image, environment, and secrets as the service. It is safe to re-run; it applies only what is pending. Run one at a time rather than from every replica at once, which is why `MIGRATE_ON_START` stays `false` in production. Every release can run against the previous release's schema, so a rollback of one version needs no database change.

## Fixing settings and branding from the deployment

Admins edit their organization's settings in the app. A deployment can also fix any of the branding, banner, navigation links, admin list, edit mode, read-only switch, and keyword pattern from the outside, so the service comes up branded with no one signing in first. Those fields show as read-only in the admin screen and a write that changes one is rejected.

Two sources, usable together:

- `CONFIG_DIR/settings.json`: a partial settings document. The image sets `CONFIG_DIR=/app/config`, so a downstream image adds `COPY config/ /app/config/`. Files under `CONFIG_DIR/branding/` are served at `/_/branding/<file>`, which is how a logo ships with the deployment (`"logoUrl": "/_/branding/logo.svg"`).
- `SETTINGS_OVERRIDES_JSON`: the same document inline, for platforms where an environment variable is easier than a file. Its fields win over the file's.

`examples/config/` at the repository root is a complete example. The settings that rewrite links when they change (the default namespace, the namespace list, punctuation sensitivity, resolution mode) cannot be fixed this way; set them once with the import command:

```bash
node apps/api/dist/cli.js settings export acme.example > settings.json
node apps/api/dist/cli.js settings import acme.example settings.json
```

Both run as one-off tasks the same way migrations do.

## Health, logs, and metrics

- `/_/health/live` answers as soon as the process is up. Use it for liveness.
- `/_/health/ready` checks Postgres and, when configured, Redis. Use it for the load balancer's health check and for readiness.
- Logs are JSON on stdout, one line per request with a request id that is also returned in the `X-Request-Id` response header. Resolver lines record the keyword and the destination host, never the full destination.
- `/_/metrics` serves Prometheus metrics when `METRICS_ENABLED=true`. It is not authenticated, so on a load balancer reachable from the internet either leave it disabled or block the path at the load balancer and scrape the tasks directly.

## Scaling

Set the replica count to what the traffic needs; the resolver is cheap and a single small task serves a large organization. Beyond one replica, Redis is required. Rate limits, sessions, and the settings cache then share state through it. Nothing else changes.

## Backups and upgrades

Back up Postgres; it is the only thing that matters. Redis holds nothing that cannot be rebuilt. An upgrade is: pull the new image, run the migration task, roll the service. A downgrade by one version is: roll the previous image; the schema is compatible.

## Making `go/` resolve

Members type `go/keyword`, so the bare name `go` must reach the load balancer from their machines. Any one of these works:

- **An internal DNS record** for the bare name `go`, pointing at the load balancer. This is the right answer for an office or VPN. A single-label name only resolves on machines whose DNS search domain includes the zone the record is in, so create it in the zone those machines search, for example `go.corp.example.com` when their search domain is `corp.example.com`.
- **The browser extension**, rolled out through Google Workspace with the service address set by policy. It rewrites `go/keyword` in the address bar without any DNS. The extension repository's README has the rollout steps; set `EXTENSION_ORIGINS` on the service to the extension's id.
- **A hosts-file entry** on a machine, for a small team or a test.

Some browsers treat a single word with a slash as a search until the name has resolved once; a single visit to `http://go/` settles it.

## Troubleshooting

- **Sign-in loops back to the sign-in page.** `BASE_URL` does not match the address in the browser, or `TRUST_PROXY` is off behind the load balancer, so the session cookie is refused or the redirect URI differs from the one registered at the provider. Compare the startup configuration line with the address bar.
- **`go/keyword` opens a web search.** The name has not resolved, or the browser has not yet seen it resolve. Visit `http://go/` once.
- **The extension's create form fails with `csrf_origin_mismatch`.** Add the extension's origin to `EXTENSION_ORIGINS` and restart.
- **Readiness fails.** The task cannot reach Postgres or Redis; the response body names the failing check. Security groups and the connection string are the usual causes.
- **The process exits at startup.** The message lists the variable or the settings field it refused and why.
- **An admin cannot change a setting.** The field is fixed by the deployment. Change it in `settings.json` or `SETTINGS_OVERRIDES_JSON` and roll the service.
