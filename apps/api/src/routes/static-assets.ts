// Static files and the single-page app (spec 04 §1). `/favicon.ico` and `/robots.txt` are
// served directly and are never treated as keywords; the built web app owns `/` and the
// client-side routes under `/_/`.

import { existsSync } from 'node:fs'
import fastifyStatic from '@fastify/static'
import { errorEnvelope } from '../errors.ts'
import { pathnameOf } from '../security/origin-check.ts'
import type { GoLinksApp } from '../types.ts'

/** Files served from the API package rather than from the web build. */
const PUBLIC_FILES = ['favicon.ico', 'robots.txt'] as const

/**
 * Paths under `/_/` the server answers itself. Anything else under `/_/` is a client-side
 * route and gets the app shell.
 */
const SERVER_OWNED_PREFIXES = [
  '/_/api',
  '/_/auth',
  '/_/health',
  '/_/metrics',
  '/_/opensearch.xml',
] as const

export function isServerOwnedPath(pathname: string): boolean {
  return SERVER_OWNED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

export interface StaticAssetOptions {
  /** Directory holding favicon.ico and robots.txt. */
  publicPath: string
  /** Directory holding the built web app, or undefined when it has not been built. */
  webDistPath: string | undefined
}

export function registerStaticAssets(app: GoLinksApp, options: StaticAssetOptions): void {
  const { publicPath, webDistPath } = options

  app.log.info({ publicPath, webDistPath: webDistPath ?? null }, 'serving static assets')

  if (existsSync(publicPath)) {
    // `wildcard: false` registers one route per file that actually exists, so the plugin never
    // shadows the keyword space with a catch-all.
    app.register(fastifyStatic, {
      root: publicPath,
      prefix: '/',
      wildcard: false,
      decorateReply: true,
      cacheControl: true,
      maxAge: '1h',
    })
  }

  if (webDistPath === undefined) return

  app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    wildcard: false,
    decorateReply: !existsSync(publicPath),
    // The API package owns these two; ignoring them here keeps the routes unambiguous.
    globIgnore: [...PUBLIC_FILES],
    index: ['index.html'],
    cacheControl: true,
    maxAge: '1h',
  })

  // Client-side routes such as /_/login and /_/admin/users are served the app shell so that a
  // cold request to a deep link works.
  app.route({
    method: ['GET', 'HEAD'],
    url: '/_/*',
    handler: async (request, reply) => {
      if (isServerOwnedPath(pathnameOf(request.url))) {
        return reply
          .code(404)
          .send(errorEnvelope('not_found', 'The requested resource does not exist.'))
      }
      return reply.header('cache-control', 'no-cache').sendFile('index.html', webDistPath)
    },
  })
}
