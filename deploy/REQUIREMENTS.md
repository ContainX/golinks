# Infrastructure requirements

What any deployment of GoLinks must provide, component by component, independent of how it is built. Organizations with their own Terraform modules, or another platform altogether, use this as the contract to build against; `terraform/aws-ecs/` is one implementation of it, and each section names the file there that does the same job, so the two can be compared line by line.

Every item is marked **must** (the service does not work without it) or **should** (the reference module does it and there is a reason to).

## Summary

| Component | Must provide |
|---|---|
| Compute | one container from the published image, port 3000, the environment below, private network with egress |
| Ingress | TLS for the canonical host; port 80 forwarded, not redirected, except for the canonical host; health check on `/_/health/ready` |
| PostgreSQL | 16 or newer, database `golinks`, a role with `CREATE` on it, TLS |
| Redis | 7 or newer; required only beyond one replica |
| Secrets | `DATABASE_URL`, `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, and `REDIS_URL` when used, injected as environment variables |
| Network | the five flows in section 7 and nothing else |
| DNS | the canonical host at the ingress; the bare short host resolvable on members' machines |
| Identity | an OIDC application with the redirect URI `<BASE_URL>/_/auth/callback/oidc` |
| One-off task | the same image and environment with the command `node apps/api/dist/cli.js migrate` |

## 1. Compute

Reference: `terraform/aws-ecs/ecs.tf`.

- **Must** run `ghcr.io/containx/golinks:<tag>`, built for `linux/amd64`. Pin a release tag. The container listens on port 3000 and runs as the unprivileged `node` user (uid 1000); nothing in it needs root, a writable root filesystem, or extra capabilities.
- **Must** set the environment in section 5 and inject the secrets in section 6. `AUTH_TEST_MODE` must never be set; the service refuses to start with it under `NODE_ENV=production`, which the image sets.
- **Must** give the tasks egress to the image registry, the identity provider, and whatever the platform needs for secrets and logs. Nothing else is called.
- **Should** run in private subnets with no public address; the ingress is the only thing that needs to be reachable.
- **Should** size the first task at 0.5 vCPU and 1 GB. The resolver is cheap; one small task serves a large organization.
- **Should** roll out with the running count never dropping (100% minimum healthy, 200% maximum), a health grace period of about 60 seconds, and automatic rollback of a deployment whose tasks never become healthy, which is what a refused configuration looks like.
- **Must** keep one replica unless Redis is provided (section 4).
- **Must** be able to run a one-off task from the same image, environment, and secrets with the command `node apps/api/dist/cli.js migrate`, once before the first start and before any release that carries a migration, one at a time. `MIGRATE_ON_START` stays `false` on the service. The same one-off task with `settings import <org> <file>` or `settings export <org>` is how settings that the overrides cannot fix are set by script.
- **Should** ship stdout to the log store as is: one JSON line per request, with a request id that is also returned to the client in `X-Request-Id`.

## 2. Ingress

Reference: `terraform/aws-ecs/alb.tf`.

Two hostnames reach the same service. The **canonical host** is the one in `BASE_URL`; the **short host** is the bare name members type, `go` by default. The service redirects any request whose `Host` is not the canonical one to the same path on the canonical origin, so the short host needs neither a certificate nor cookies. Everything the app serves, including sign-in, the API, and the session cookie, is HTTPS on the canonical host; the only response the service ever gives over plain HTTP is that redirect, and a browser typing `go/keyword` without a scheme always starts with HTTP, which is why port 80 has to exist at all. A deployment that rolls out the browser extension, which rewrites `go/keyword` to the HTTPS origin inside the browser, can close port 80 for those machines.

- **Must** terminate TLS for the canonical host and forward to the tasks on port 3000 over HTTP.
- **Must** forward port 80 to the tasks rather than redirecting it to HTTPS, because that is the port a bare `go/keyword` arrives on. The one rule: plain HTTP whose host header equals the canonical host is redirected to HTTPS at the edge.
- **Must** pass the `Host` header through unchanged and set `X-Forwarded-Proto`, `X-Forwarded-Host`, and `X-Forwarded-For`; the service reads them with `TRUST_PROXY=true` and trusts only the immediate proxy.
- **Must** health check `GET /_/health/ready` expecting 200. Reference values: every 15 seconds, 5 second timeout, healthy after 2, unhealthy after 3, and a 30 second deregistration delay; requests are short so there is little to drain.
- **Should** admit ports 80 and 443 from the members' network, whether that is the internet or a VPN range, and nothing else. An internal load balancer is the right shape for a VPN-only deployment.
- **Should** block `/_/metrics` at the edge, or leave `METRICS_ENABLED` off, when the ingress is reachable from the internet; the endpoint is not authenticated.

## 3. PostgreSQL

Reference: `terraform/aws-ecs/rds.tf`.

- **Must** be PostgreSQL 16 or newer with a database named in `DATABASE_URL` (the reference uses `golinks`).
- **Must** let the application role install `pg_trgm` and `citext`: the first migration runs `CREATE EXTENSION IF NOT EXISTS` for both. They are trusted extensions since PostgreSQL 13, so `CREATE` on the database is enough and the managed master user works. A platform that forbids that installs both extensions ahead of time instead.
- **Must** connect over TLS on managed services that require it; `DATABASE_URL` carries `?sslmode=require`, which the client honors. The password must be URL encoded in the connection string.
- **Must** be reachable from the tasks only, on 5432.
- **Should** start at the smallest instance class with 20 GB of autoscaling storage, encrypted at rest, with at least 7 days of automated backups. This is the only stateful store; it is the one thing to back up and the one thing a restore brings back.
- **Should** apply changes in the maintenance window rather than immediately, so an infrastructure change during the day never restarts the database under the running service.

## 4. Redis

Reference: `terraform/aws-ecs/redis.tf`.

- **Must** exist when more than one replica runs: sessions, the settings cache, and rate-limit counters have to be shared between replicas. One replica runs without it, with sessions and caches in Postgres.
- **Must** be Redis 7 or newer, reachable from the tasks only, on 6379.
- **Should** encrypt in transit; the client accepts `rediss://` URLs. An auth token is optional and, if used, travels as the password in `REDIS_URL`.
- **May** be flushed or replaced at any time. It holds nothing that cannot be rebuilt; members sign in again.

## 5. Environment

Reference: the `environment` local in `terraform/aws-ecs/ecs.tf`. Every variable is documented with its default in `.env.example` at the repository root; these are the ones a production deployment sets.

| Variable | Value |
|---|---|
| `BASE_URL` | the canonical origin, for example `https://links.example.com` |
| `SHORT_HOST` | the bare name members type; `go` unless the organization chose another |
| `TRUST_PROXY` | `true` |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID` | from the identity provider; the secret is in section 6 |
| `OIDC_SCOPES`, `OIDC_LABEL`, `OIDC_ADMIN_GROUPS`, `OIDC_LOGOUT_AT_IDP` | optional; `OIDC_ADMIN_GROUPS` needs the `groups` scope and a groups claim |
| `ORG_RESOLUTION` | `fixed` with `ORG_FIXED_ID` for one organization, or `domain` for one per email domain; `ORG_ALLOWED_IDS` optionally limits the latter |
| `INITIAL_ADMIN_EMAILS` | comma-separated; or rely on `OIDC_ADMIN_GROUPS` |
| `EXTENSION_ORIGINS` | `chrome-extension://<id>` when the browser extension is rolled out |
| `MIGRATE_ON_START` | `false` |
| `METRICS_ENABLED` | `false` unless the endpoint is protected at the edge |
| `LOG_LEVEL` | `info` |
| `SETTINGS_OVERRIDES_JSON` | optional; the deployment settings overrides document (section 10) |

`PORT`, `HOST`, and `NODE_ENV` are set by the image and stay as they are.

## 6. Secrets

Reference: `terraform/aws-ecs/secrets.tf`.

- **Must** inject these as environment variables at start, from whatever secret store the platform has: `DATABASE_URL`, `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, and `REDIS_URL` when Redis is used.
- **Must** generate `SESSION_SECRET` with at least 32 random bytes. Rotating it signs everyone out, which is the intended way to end every session at once.
- **Should** let the identity that starts the container read exactly these secrets and nothing else. The reference keeps all four keys in one secret and scopes the read to it.
- **Should** keep any generated password out of the image, the task definition, and version control. A Terraform-generated password lives in state, so state needs an encrypted backend.

## 7. Network flows

Reference: `terraform/aws-ecs/network.tf`.

| From | To | Port | Purpose |
|---|---|---|---|
| members' network | ingress | 80 | the short host |
| members' network | ingress | 443 | the canonical host |
| ingress | tasks | 3000 | forwarded requests and the health check |
| tasks | PostgreSQL | 5432 | the database |
| tasks | Redis | 6379 | sessions and caches, when used |
| tasks | egress | 443 | image registry, identity provider, secrets and log endpoints |

**Must** allow these; **should** allow nothing else. In particular nothing in the network other than the tasks should be able to open a connection to the data stores.

## 8. DNS and certificates

Reference: `terraform/aws-ecs/dns.tf`.

- **Must** resolve the canonical host to the ingress, and hold a valid certificate for it there.
- **Must** resolve the bare short host, `go`, to the ingress from members' machines. A single-label name only resolves on machines whose DNS search domain includes the zone the record is in, so the record goes in the zone those machines search, for example `go.corp.example.com` when their search domain is `corp.example.com`. Organizations whose client DNS is not on the cloud platform create the record wherever their clients resolve; the ingress only needs the name to land on it over port 80.
- **Must not** need a certificate for the short host. It is plain HTTP and the service redirects it.
- **Should** treat the browser extension, rolled out by policy, as the alternative for machines that cannot be given the DNS record; it rewrites `go/keyword` without DNS.

## 9. Identity provider

- **Must** be an OIDC application using the authorization code grant. Sign-in redirect URI: `<BASE_URL>/_/auth/callback/oidc` (the last segment is `OIDC_ID`, `oidc` by default). Sign-out redirect URI: `<BASE_URL>/`.
- **Must** issue the `openid`, `email`, and `profile` scopes. Add `groups` and a groups claim when `OIDC_ADMIN_GROUPS` is used.
- **Must** be reachable from the tasks: the service fetches the provider's metadata and keys and exchanges codes server-side.

## 10. Deployment-level configuration

Reference: the `settings_overrides` variable in `terraform/aws-ecs/variables.tf`, and `examples/config/` at the repository root.

- **May** fix organization settings from the deployment through `SETTINGS_OVERRIDES_JSON` in the environment, which needs no volume, or through a `settings.json` under `CONFIG_DIR` (`/app/config` in the image) baked into a downstream image or mounted. Files under `CONFIG_DIR/branding/` are served at `/_/branding/` for a logo shipped with the deployment.
- **Must** treat a change to the overrides as a rollout: the document is read once at startup.
- **Must not** expect to fix the default namespace, the namespace list, punctuation sensitivity, or the resolution mode this way; they are set once with the one-off `settings import` task.

## 11. Observability

- **Must** probe `/_/health/live` for liveness and `/_/health/ready` for readiness and routing. Readiness returns a 503 with a per-check report when Postgres or Redis is unreachable.
- **Should** retain the JSON logs somewhere searchable by request id.
- **May** scrape `/_/metrics` in Prometheus format with `METRICS_ENABLED=true`, protected at the edge as noted in section 2.

## Checklist

- [ ] Canonical hostname chosen; certificate issued at the ingress
- [ ] OIDC application registered with the redirect URI and sign-out URI above
- [ ] PostgreSQL 16+, database and role created, TLS required, reachable from the tasks only
- [ ] Redis 7+ when running more than one replica
- [ ] Secrets stored: `DATABASE_URL`, `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `REDIS_URL`
- [ ] Task environment from section 5; `TRUST_PROXY=true`; no `AUTH_TEST_MODE`
- [ ] Ingress: 443 terminates TLS, 80 forwards, canonical host on 80 redirects, health check on `/_/health/ready`
- [ ] Network flows from section 7 and nothing else
- [ ] One-off migration task run once before the first start
- [ ] DNS: canonical host at the ingress; `go` resolvable on members' machines
- [ ] Logs retained; `/_/metrics` off or blocked at the edge
- [ ] Overrides for branding in `SETTINGS_OVERRIDES_JSON` or `CONFIG_DIR`, if wanted
