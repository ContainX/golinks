# Contributing

Thanks for working on GoLinks. This page is the set of expectations every change is held to. `CLAUDE.md` is the working guide for AI-assisted changes; the rules here apply either way.

## Start with the spec

The specifications under `docs/specs/` are the source of truth for behavior; `docs/specs/00-overview.md` is the reading order. A change that alters behavior updates the spec in the same pull request, and when the code and a spec disagree, one of them is fixed in the same change rather than left apart. Code comments cite the section they implement (`spec 03 §5`), which is how a reader gets from a rule to its reason.

Use the specs' vocabulary everywhere: keyword, namespace, resolution, transfer, short host, canonical host. Documentation describes this product on its own terms and never compares it to, or references, other products.

## Before opening a pull request

Every one of these has to pass:

```bash
pnpm typecheck && pnpm lint && pnpm test   # types, Biome, unit tests in every package
pnpm test:api                              # API integration tests on an embedded Postgres
pnpm build                                 # the API bundle and the web app
```

`pnpm test:e2e` runs the browser tests against a running deployment and is what CI runs on the full compose profile; run it locally when a change touches a screen or a flow.

Format only what you touched: `pnpm exec biome check --write <paths>`.

## Code conventions

- TypeScript strict with `noUncheckedIndexedAccess`; relative imports carry explicit `.ts` and `.tsx` extensions.
- Biome formats: single quotes, no semicolons, width 100.
- Comments explain why, briefly. A file starts with a short note on what it is for and which spec section it serves.
- Unit tests sit next to the code as `*.test.ts`; integration tests live in `apps/api/test/integration` on the embedded Postgres harness, and prove organization isolation with the two test organizations, `widgets.test` and `gizmos.test`.

## Rules that are easy to break

- **Route ownership.** `/` and `/_/**` belong to the application; every other path is a keyword handled by the resolver. Never add a top-level route or a client route outside `/_/`. A new server-owned path under `/_/` is listed in the static asset module's server-owned prefixes and in the Vite proxy.
- **Every API route is documented.** The OpenAPI document is generated from the zod schemas each route declares, and a test holds the set of operations equal to the list in spec 05 §3. Adding an endpoint means adding it to the spec, the route, and that test.
- **Errors come from the catalog.** Throw `ApiError` with a code from the shared catalog; a new code is added there and to spec 05 §4 together.
- **Rules live in the domain, not in handlers.** Link creation, renaming, and deletion go through the links service, which runs the validation order, the advisory lock, conflict detection, and audit events. Route handlers hold no rules.
- **Settings fields have consequences.** A new organization setting is either safe to fix from a deployment (it leaves stored links untouched) or it is not; put it in the deployment overrides schema only in the first case, and say why in spec 06 §6.
- **Migrations roll forward safely.** A migration must work with the previous release still running, so a rolling deploy and a one-version rollback both succeed.
- **Security headers stay strict.** The content security policy allows no third-party font, script, or style host and no inline scripts. Fonts and libraries are bundled; a change that needs an outside host needs a discussion first.
- **Fork-owned files stay untouched.** `apps/web/src/branding/overrides.ts` and `fonts.ts` belong to deployments. Upstream never edits them, so forks merge cleanly.
- **Test sign-in never reaches production.** `AUTH_TEST_MODE` exists for tests and local development only; the service refuses it under `NODE_ENV=production`, and nothing may weaken that.

## Screens and flows

UX flows are deliberately not specified in `docs/specs/08-web-app-features.md`. Before designing a new screen, flow, or navigation, open an issue and discuss it; the visual direction and the decided flows are recorded in the decision records, and a change that departs from them needs a decision of its own.

## Commits and pull requests

- One change per pull request, with the spec change, the code, and the tests together.
- Commit subjects are short and plain, in the imperative, with no body and no trailers: `Serve the OpenAPI document`, `Remove the short-host setup notice`.
- The pull request description says what changed and why in a few sentences, and names the spec sections it touches.
- Never commit secrets, `.env`, or generated output; `.env.example` documents every variable and is updated when one is added.

## Reporting a security issue

Do not open a public issue for a vulnerability. Contact the maintainers privately through the repository's security advisory page and allow time for a fix before disclosure.
