# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

GoLinks is a TypeScript short-link service: members type `go/<keyword>` and are redirected to a destination URL scoped to their organization. The specs under `docs/specs/` (start with `00-overview.md`) are the source of truth for behavior; `docs/decisions/` holds the ADRs (0001 fixes the stack).

## Commands

```bash
pnpm install                                  # pnpm 12, Node 24+ (.nvmrc says 26)
pnpm dev                                      # API on :3000 (tsx watch) and web on :5173 (Vite, proxies /_/api, /_/auth)
pnpm typecheck && pnpm lint && pnpm test      # tsc per package, Biome, Vitest unit tests
pnpm build                                    # apps/api/dist (esbuild bundle: index.js + cli.js), apps/web/dist
pnpm test:api                                 # API integration tests on an embedded Postgres (no Docker needed)
pnpm test:e2e                                 # Playwright against E2E_BASE_URL (default http://localhost:3000)
pnpm --filter @golinks/api migrate            # apply migrations from DATABASE_URL
pnpm --filter @golinks/api dev:db             # embedded Postgres for local dev when Docker is unavailable
pnpm --filter @golinks/api exec vitest run src/resolver            # one unit suite (path filter)
pnpm --filter @golinks/api exec vitest run --config vitest.integration.config.ts test/integration/links-   # one integration area
pnpm --filter @golinks/web test -- -t "theme"                       # one test by name
pnpm exec biome check --write <paths>         # format/lint only what you touched
```

`docker compose up -d` gives Postgres 16 (pg_trgm, citext) and Redis 7; `--profile full` also builds and runs the service image. `.env.example` documents every variable; local defaults enable test sign-in (`AUTH_TEST_MODE`) so no identity provider is needed.

## Layout

- `packages/shared` (`@golinks/shared`): zod v4 schemas for every API resource and request (`src/api`), the organization settings document (`src/settings`), the deployment config (`src/config`), and pure, browser-safe rules: keywords (`src/keywords`, `evaluateKeyword`, `matchKeywordSegments`), destinations (`src/destinations`, `buildRedirectLocation`), organization resolution from email (`src/organizations`). Consumed from source via package `exports`; no build step.
- `apps/api` (`@golinks/api`): Fastify 5 with the zod type provider, Drizzle + postgres.js, openid-client, ioredis, pino. `src/app.ts` is the factory; `src/index.ts` the process entry.
- `apps/web` (`@golinks/web`): Vite + React 19 + MUI 9, TanStack Query, react-router 8 data router. Typed API client in `src/api`, query hooks in `src/queries`, runtime branding in `src/app`.
- `e2e`: Playwright smoke tests; screens are deliberately still placeholders.

## Architecture you need to know

- **Route ownership** (spec 04 §1): `/` and `/_/**` belong to the application (web app, `/_/api/v1`, `/_/auth`, `/_/health`, `/_/metrics`, `/_/opensearch.xml`); every other path is a keyword handled by the resolver catch-all in `apps/api/src/routes/resolver.ts`. Never add a top-level route or client route outside `/_/`.
- **Request pipeline in `buildApp`**: short-host bounce (any non-canonical `Host` is redirected to `BASE_URL`) → security headers → sessions → rate limits → Origin CSRF check → error handler → `request.member` resolver → metrics → static/SPA → `plugins` option → health, OpenSearch, API composition (`routes/api.ts`), resolver. Hooks added before `await app.after()` run before plugin hooks.
- **Seams to use, not rebuild**: `app.db` (Drizzle; tests pass `database` to `buildTestApp`), `app.organizationSettings` (cached settings service), `request.member` / `app.setMemberResolver` (identity plugin installs the real one), `app.rateLimits.{api,linkCreate,resolver}`, `app.metrics` (`recordResolverOutcome`, `recordJobRun`), `app.addReadinessCheck`, `app.resolverLookup` / `app.visitRecorder`.
- **Errors**: throw `ApiError(code, message, { existingLink })` from `apps/api/src/errors.ts`; codes and statuses come from the shared catalog (`API_ERROR_STATUS`), so add new codes there and in spec 05 §4.
- **Links domain** (`apps/api/src/links`): `createLinkWithChecks` / `renameLinkWithChecks` / `deleteLinkWithChecks` run the full validation order, the advisory lock, conflict detection, and audit events; route handlers hold no rules. `linkPermissionsFor` is the spec 03 §5 matrix.
- **Identity** (`apps/api/src/auth`): `completeSignIn` is the single entry for every sign-in method (OIDC, test token); guards `requireMember` / `requireAdmin`.
- **Tests**: unit tests sit next to code (`*.test.ts`); integration tests live in `apps/api/test/integration` on the embedded Postgres harness (`useTestDatabase`, `resetDatabase`), with `sign-in.ts` (`buildIdentityApp`, `signIn`) for authenticated calls. Two organizations, `widgets.test` and `gizmos.test`, prove isolation.

## Deploying and customizing a deployment

- `deploy/README.md` is the operator guide: what runs, prerequisites, configuration, migrations as a one-off task, health and logs, scaling, DNS for the short host, troubleshooting. `deploy/okta.md` is the Okta administrator's walkthrough and the hand-back list. `deploy/REQUIREMENTS.md` is the platform-neutral contract (what each component must provide, with the reference file for each) for organizations that use their own modules. `deploy/terraform/aws-ecs/` is reference infrastructure for ECS Fargate, RDS, ElastiCache, and an ALB; its README is the runbook for that stack.
- A deployment fixes organization settings without the admin screen through `CONFIG_DIR/settings.json` or `SETTINGS_OVERRIDES_JSON` (spec 06 §6; README "Customizing a deployment"; `examples/config/`). Only fields that leave stored links untouched are accepted; the rest go through `golinks settings import`. Files under `CONFIG_DIR/branding/` are served at `/_/branding/`.
- Runtime branding comes from the settings document (`branding`, with `light`/`dark` scheme colors). A fork's build-time defaults go in `apps/web/src/branding/overrides.ts` and `fonts.ts`, which upstream never edits; do not put fork-specific values anywhere else in the web app.
- Facts that bite on a real platform: the first migration runs `CREATE EXTENSION` (trusted extensions, so `CREATE` on the database suffices); both the canonical host and the bare short host must route to the service, with `TRUST_PROXY=true` behind a load balancer; Redis is required beyond one replica; `/_/metrics` is unauthenticated when enabled.

## Conventions

- Documentation describes this product on its own terms. Do not compare it to, or reference, other go-link products.
- Naming follows the specs' vocabulary: keyword, namespace, resolution, transfer, short host, canonical host.
- UX flows are intentionally left out of `docs/specs/08-web-app-features.md`. Stop and discuss with the user before designing screens, flows, or navigation.
- Relative imports carry explicit `.ts`/`.tsx` extensions; TypeScript strict with `noUncheckedIndexedAccess`; Biome formats (single quotes, no semicolons, width 100).
- Work is tracked with beads (`bd`); `bd ready` shows what can start, and each task's `spec-id` names the spec it implements.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
