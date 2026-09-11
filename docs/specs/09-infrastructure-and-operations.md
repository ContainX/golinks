# 09. Infrastructure and Operations

## 1. Runtime shape

- One container image runs the service: resolver, API, web app assets, and background jobs (visit retention, scheduled cleanups).
- Postgres 16 or newer with the `pg_trgm` and `citext` extensions.
- Redis 7 or newer, optional. Recommended for more than one replica.
- Horizontal scaling is supported once Redis is configured for sessions. Background jobs use a Postgres advisory lock so that only one replica runs each job at a time.

## 2. Local development with Docker

`docker compose up` in the repository root starts:

| Service | Purpose |
|---|---|
| postgres | Database with extensions installed by an init script; data in a named volume |
| redis | Session store and caches |
| mailpit or similar | Not needed in v1; listed only if email is added later |

The application itself runs on the host during development (hot reload for API and web) and connects to the containers. A `docker compose --profile full up` variant also builds and runs the application container for end-to-end tests and demos.

`.env.example` documents every variable from spec 06 §1 with local defaults. Local sign-in uses test mode (spec 02 §8) by default so that no Okta tenant is required to develop; a documented alternative points at a real Okta developer org.

## 3. Database migrations

- Migrations are versioned SQL files checked into the repository and applied with the ORM's migration runner.
- The container applies pending migrations on startup when `MIGRATE_ON_START=true` (default in compose, recommended off in production in favor of a dedicated migration step in the deploy pipeline).
- A CLI command `golinks migrate` applies migrations explicitly.
- Migrations MUST be backward compatible with the previous application version for one release, so that rolling deploys work.

## 4. Configuration and secrets

All configuration is environment variables (spec 06 §1). Secrets are never baked into the image. The service logs its effective non-secret configuration at startup.

A deployment that wants to fix organization settings and serve its own branding files (spec 06 §6) puts them in one directory, named by `CONFIG_DIR`:

```
/app/config
  settings.json      organization settings the deployment fixes; optional
  branding/          files served at /_/branding, for example logo.svg; optional
```

The image sets `CONFIG_DIR=/app/config` and ships the directory empty and owned by the runtime user, so nothing more is needed than putting files there:

- **Docker.** `COPY config/ /app/config/` in an image built on top of this one, or `-v ./config:/app/config:ro` on the container. The commented volume in `docker-compose.yml` is the same mount for local use.
- **Kubernetes.** Mount a ConfigMap at `/app/config` (`settings.json` as one key) and, when the branding files are their own resource, a second ConfigMap at `/app/config/branding`. `settings.json` is read once at startup, so changing it needs a rollout; branding files are read per request, so replacing one takes effect as the mount updates.
- **ECS.** Either bake the directory into a downstream image, or mount an EFS access point at `/app/config`. A task definition that has neither can still set `SETTINGS_OVERRIDES_JSON` in its container environment, which needs no volume at all.

`SETTINGS_OVERRIDES_JSON` is read after the file and wins field by field, so one variable can adjust a mounted document without rebuilding it. A settings document that does not validate stops the process at startup with one line per field.

## 5. Observability

- Structured JSON logs to stdout with request id, member id (when signed in), organization id, route, status, and duration. Resolver logs record namespace, keyword, hit or miss, and the destination host, never the full destination.
- `X-Request-Id` is accepted from a trusted proxy or generated.
- Health: `/_/health/live` and `/_/health/ready` (spec 05 §3).
- Metrics: `/_/metrics` when enabled (spec 07 §3).
- Errors MAY be reported to an external error tracker when its DSN is configured; the integration is optional and off by default.

## 6. Rate limiting and protection

- Rate limits per spec 05 §5, backed by Redis when available and in-process otherwise.
- Request body limit 64 KB on the API.
- The resolver ignores request bodies.

## 7. Reverse proxy and TLS

The service expects to sit behind a reverse proxy or ingress that terminates TLS for the canonical host and forwards the short host as plain HTTP (spec 11). With `TRUST_PROXY=true` the service honors `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-For` from the immediate proxy only.

## 8. Build and CI

Pipeline on every pull request:

1. Install, type-check, lint.
2. Unit tests.
3. API integration tests against a Postgres service container.
4. Build the web app and the container image.
5. End-to-end tests against the built image with test sign-in enabled.

On merge to `main`: publish the image to the GitHub Container Registry tagged with the git SHA and `latest`. Releases are tagged semantic versions that also tag the image.

## 9. Backups and upgrades

- Postgres is the only stateful store. Redis holds only sessions and caches and may be flushed at any time; members simply sign in again.
- Upgrading is: deploy the new image, run migrations. Downgrading one version is supported by the migration compatibility rule (§3).
