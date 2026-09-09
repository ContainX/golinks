// Static files and the single-page app (spec 04 §1). `/favicon.ico` and `/robots.txt` are
// served directly and are never treated as keywords; the built web app owns `/` and the
// client-side routes under `/_/`.
//
// A deployment that mounts a configuration directory (spec 06 §6) also gets `/_/branding`,
// where the files in `<CONFIG_DIR>/branding` are served so that `branding.logoUrl` can point
// at `/_/branding/logo.svg` instead of at a host the members' browsers have to reach.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import { type DeploymentSettingsOverrides, NO_DEPLOYMENT_OVERRIDES } from '@golinks/shared/settings'
import type { FastifyReply } from 'fastify'
import { errorEnvelope } from '../errors.ts'
import { pathnameOf } from '../security/origin-check.ts'
import type { GoLinksApp } from '../types.ts'
import { isEmptyShellBranding, shellBrandingOf, transformIndexHtml } from './index-html.ts'

/** Files served from the API package rather than from the web build. */
const PUBLIC_FILES = ['favicon.ico', 'robots.txt'] as const

/** The app shell, served for `/` and for every client-side route. */
const INDEX_FILE = 'index.html'

/** Where a deployment's own branding files are served (spec 06 §6). */
export const BRANDING_PREFIX = '/_/branding'

/** What the shell and the branding files are cached for, matching every other static file. */
const STATIC_CACHE_CONTROL = 'public, max-age=3600'

/**
 * Paths under `/_/` the server answers itself. Anything else under `/_/` is a client-side
 * route and gets the app shell.
 */
const SERVER_OWNED_PREFIXES = [
  '/_/api',
  '/_/auth',
  BRANDING_PREFIX,
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
  /**
   * Directory holding the deployment's branding files, served at `/_/branding`. Undefined,
   * or missing on disk, and the prefix answers 404 like any other unknown path.
   */
  brandingPath?: string | undefined
  /** The settings this deployment fixes, for the shell's first paint (spec 06 §6). */
  settingsOverrides?: DeploymentSettingsOverrides
}

export function registerStaticAssets(app: GoLinksApp, options: StaticAssetOptions): void {
  const { publicPath, webDistPath } = options
  const brandingPath =
    options.brandingPath !== undefined && existsSync(options.brandingPath)
      ? options.brandingPath
      : undefined

  app.log.info(
    { publicPath, webDistPath: webDistPath ?? null, brandingPath: brandingPath ?? null },
    'serving static assets',
  )

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

  if (brandingPath !== undefined) registerBrandingFiles(app, brandingPath)

  if (webDistPath === undefined) return

  // Read once, at startup: every request that follows is served the same string.
  const shell = readShell(app, webDistPath, options.settingsOverrides ?? NO_DEPLOYMENT_OVERRIDES)

  app.register(fastifyStatic, {
    root: webDistPath,
    prefix: '/',
    wildcard: false,
    decorateReply: !existsSync(publicPath),
    // The API package owns the first two; the shell is served from memory when the deployment
    // has changed it, and by the plugin when it has not.
    globIgnore: shell === undefined ? [...PUBLIC_FILES] : [...PUBLIC_FILES, INDEX_FILE],
    index: shell === undefined ? [INDEX_FILE] : false,
    cacheControl: true,
    maxAge: '1h',
  })

  if (shell !== undefined) {
    app.route({
      method: ['GET', 'HEAD'],
      // Both names the plugin would have answered on: the directory and the file itself.
      url: '/',
      handler: async (_request, reply) => sendShell(reply, shell, STATIC_CACHE_CONTROL),
    })
    app.route({
      method: ['GET', 'HEAD'],
      url: `/${INDEX_FILE}`,
      handler: async (_request, reply) => sendShell(reply, shell, STATIC_CACHE_CONTROL),
    })
  }

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
      if (shell !== undefined) return sendShell(reply, shell, 'no-cache')
      return reply.header('cache-control', 'no-cache').sendFile(INDEX_FILE, webDistPath)
    },
  })
}

/**
 * The deployment's own files under `/_/branding`, public and cached for an hour.
 *
 * Nothing here is generated: the directory is whatever the image or the mounted volume holds,
 * so directory listings are off, dotfiles are not served, and a name that is not there answers
 * with the error envelope through the not-found handler rather than with a bare 404.
 */
function registerBrandingFiles(app: GoLinksApp, root: string): void {
  app.register(fastifyStatic, {
    root,
    prefix: `${BRANDING_PREFIX}/`,
    // A wildcard route rather than one route per file: a mounted ConfigMap changes under a
    // running process, and a file added after startup has to be served too.
    wildcard: true,
    decorateReply: false,
    index: false,
    list: false,
    redirect: false,
    // The plugin's own default is to serve dotfiles; a mounted directory may hold a
    // `..data` symlink or a saved editor file, and none of that is the deployment's branding.
    serveDotFiles: false,
    dotfiles: 'ignore',
    cacheControl: true,
    maxAge: '1h',
  })
}

function sendShell(reply: FastifyReply, html: string, cacheControl: string): FastifyReply {
  return reply
    .header('content-type', 'text/html; charset=utf-8')
    .header('cache-control', cacheControl)
    .send(html)
}

/**
 * The app shell with the deployment's branding in it, or undefined when the deployment has
 * changed nothing about it and the built file can be served as it is.
 */
function readShell(
  app: GoLinksApp,
  webDistPath: string,
  overrides: DeploymentSettingsOverrides,
): string | undefined {
  if (isEmptyShellBranding(shellBrandingOf(overrides))) return undefined

  const file = join(webDistPath, INDEX_FILE)
  try {
    const html = readFileSync(file, 'utf8')
    const transformed = transformIndexHtml(html, overrides)
    return transformed === html ? undefined : transformed
  } catch (error) {
    // The web build is still there; only the branding in the first paint is lost.
    app.log.warn({ err: error, file }, 'the app shell could not be read; serving it unchanged')
    return undefined
  }
}
