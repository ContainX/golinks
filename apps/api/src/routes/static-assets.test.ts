import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import { isServerOwnedPath } from './static-assets.ts'

const SHELL_MARKER = '<div id="root"></div>'

/** A small stand-in for the built shell, with the head the first-paint transform reads. */
const SHELL = `<!doctype html>
<html lang="en">
  <head>
    <title>GoLinks</title>
    <style>
      :root { background-color: #f6f7fb; }
      @media (prefers-color-scheme: dark) { :root { background-color: #0b1020; } }
    </style>
  </head>
  <body>
    ${SHELL_MARKER}
  </body>
</html>
`

let webDistPath: string
let app: GoLinksApp | undefined

beforeAll(() => {
  webDistPath = mkdtempSync(join(tmpdir(), 'golinks-web-'))
  mkdirSync(join(webDistPath, 'assets'))
  writeFileSync(join(webDistPath, 'index.html'), SHELL)
  writeFileSync(join(webDistPath, 'assets', 'app.js'), 'export const directory = true\n')
})

afterAll(() => {
  rmSync(webDistPath, { recursive: true, force: true })
})

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('server owned paths', () => {
  it('separates the routes the server answers from the client-side ones', () => {
    expect(isServerOwnedPath('/_/api/v1/links')).toBe(true)
    expect(isServerOwnedPath('/_/auth/login')).toBe(true)
    expect(isServerOwnedPath('/_/branding/logo.svg')).toBe(true)
    expect(isServerOwnedPath('/_/health/ready')).toBe(true)
    expect(isServerOwnedPath('/_/metrics')).toBe(true)
    expect(isServerOwnedPath('/_/opensearch.xml')).toBe(true)
    expect(isServerOwnedPath('/_/login')).toBe(false)
    expect(isServerOwnedPath('/_/admin/users')).toBe(false)
  })
})

describe('single-page app hosting', () => {
  it('serves the app shell at the directory root', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain(SHELL_MARKER)
  })

  it('serves the app shell for a client-side route', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/_/login?redirectTo=/handbook' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain(SHELL_MARKER)
  })

  it('serves the app bundle', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/assets/app.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('directory')
  })

  it('never serves the shell for an unknown server route', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/_/api/v1/nothing-here' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })

  it('never serves the shell for a keyword', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/handbook' })

    // The resolver owns it: an anonymous request goes to sign-in, never to the shell.
    expect(response.statusCode).toBe(302)
    expect(response.headers.location).toBe('/_/auth/login?redirectTo=%2Fhandbook')
  })

  it('still answers when the web app has not been built', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })
})

describe('the app shell under deployment branding (spec 06 §6)', () => {
  const overrides = {
    branding: {
      title: 'Acme Links',
      light: { backgroundColor: '#fdfdfd' },
      dark: { backgroundColor: '#101014' },
    },
  } as const

  it('serves the built file untouched when the deployment fixes nothing about it', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.body).toBe(SHELL)
  })

  it('carries the title and the grounds into the first paint', async () => {
    app = await buildTestApp({ webDistPath, settingsOverrides: overrides })

    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.headers['cache-control']).toBe('public, max-age=3600')
    expect(response.body).toContain('<title>Acme Links</title>')
    expect(response.body).toContain(':root[data-dark] { background-color: #101014; }')
    expect(response.body).toContain(SHELL_MARKER)
  })

  it('serves the same shell for a client-side route, uncached', async () => {
    app = await buildTestApp({ webDistPath, settingsOverrides: overrides })

    const response = await app.inject({ method: 'GET', url: '/_/admin/settings' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-cache')
    expect(response.body).toContain('<title>Acme Links</title>')
  })

  it('serves it at /index.html too, which the static plugin no longer answers', async () => {
    app = await buildTestApp({ webDistPath, settingsOverrides: overrides })

    const response = await app.inject({ method: 'GET', url: '/index.html' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('<title>Acme Links</title>')
  })

  it('still serves the rest of the build from disk', async () => {
    app = await buildTestApp({ webDistPath, settingsOverrides: overrides })

    const response = await app.inject({ method: 'GET', url: '/assets/app.js' })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('directory')
  })
})

describe('/_/branding without a configuration directory', () => {
  it('answers in the error envelope rather than with the app shell', async () => {
    app = await buildTestApp({ webDistPath })

    const response = await app.inject({ method: 'GET', url: '/_/branding/logo.svg' })

    expect(response.statusCode).toBe(404)
    expect(response.json().error.code).toBe('not_found')
  })
})
