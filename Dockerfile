# syntax=docker/dockerfile:1

# One image runs the whole service: resolver, HTTP API, web app assets, and
# background jobs (spec 09 section 1).

# Tracks .nvmrc. Override at build time to pin a different Node release line.
ARG NODE_VERSION=26

# ---------------------------------------------------------------------------
# base: Node plus the pinned pnpm from the root package.json packageManager field
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS base
# Node 25+ images no longer bundle corepack, so install the pnpm release pinned by the
# root package.json packageManager field directly.
ARG PNPM_VERSION=12.3.4
RUN npm install -g pnpm@${PNPM_VERSION}
WORKDIR /app

# ---------------------------------------------------------------------------
# build: install every dependency, build the web app and the API bundle, then
# prune the workspace down to production dependencies
# ---------------------------------------------------------------------------
FROM base AS build

# Manifests first so the install layer is reused whenever only sources change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .

# apps/web/dist holds the single-page app the API serves in production.
# apps/api/dist/index.js is the service entry point and apps/api/dist/cli.js the
# command-line tool the entrypoint uses for migrations (see docker/entrypoint.sh).
RUN pnpm --filter @golinks/web build \
 && pnpm --filter @golinks/api build

# Drop devDependencies from the virtual store so the runtime stage copies only
# what production needs.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------------------------------------------------------------------------
# runtime: no package manager, no toolchain, non-root
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    MIGRATE_ON_START=false

WORKDIR /app

# The node user ships with the official image (uid 1000).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages ./packages
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build --chown=node:node /app/apps/api/public ./apps/api/public
# The service serves the single-page app from its sibling web package's build output.
COPY --from=build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --chown=node:node docker/entrypoint.sh /usr/local/bin/golinks-entrypoint

RUN chmod +x /usr/local/bin/golinks-entrypoint

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=6 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/_/health/live').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/golinks-entrypoint"]
CMD ["node", "apps/api/dist/index.js"]
