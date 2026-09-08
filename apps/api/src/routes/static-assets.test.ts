import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp } from '../types.ts'
import { isServerOwnedPath } from './static-assets.ts'

const SHELL_MARKER = '<div id="root"></div>'

let webDistPath: string
let app: GoLinksApp | undefined

beforeAll(() => {
  webDistPath = mkdtempSync(join(tmpdir(), 'golinks-web-'))
  mkdirSync(join(webDistPath, 'assets'))
  writeFileSync(
    join(webDistPath, 'index.html'),
    `<!doctype html><html><body>${SHELL_MARKER}</body></html>`,
  )
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
