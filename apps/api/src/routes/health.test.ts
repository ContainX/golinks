import { afterEach, describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'
import type { GoLinksApp, ReadinessCheck } from '../types.ts'

const passing = (name: string): ReadinessCheck => ({ name, check: async () => {} })

const failing = (name: string, reason: string): ReadinessCheck => ({
  name,
  check: async () => {
    throw new Error(reason)
  },
})

let app: GoLinksApp | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

describe('health endpoints', () => {
  it('reports liveness as soon as the process is up', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/health/live' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'live' })
  })

  it('reports readiness when every dependency answers', async () => {
    app = await buildTestApp({
      readinessChecks: [passing('database'), passing('sessions')],
    })

    const response = await app.inject({ method: 'GET', url: '/_/health/ready' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      status: 'ready',
      failed: [],
      checks: [
        { name: 'database', status: 'up' },
        { name: 'sessions', status: 'up' },
      ],
    })
  })

  it('answers 503 and names the dependencies that did not answer', async () => {
    app = await buildTestApp({
      readinessChecks: [failing('database', 'connection refused'), passing('sessions')],
    })

    const response = await app.inject({ method: 'GET', url: '/_/health/ready' })

    expect(response.statusCode).toBe(503)
    const body = response.json()
    expect(body.status).toBe('unavailable')
    expect(body.failed).toEqual(['database'])
    expect(body.checks).toContainEqual({
      name: 'database',
      status: 'down',
      error: 'connection refused',
    })
  })

  it('is ready with nothing to probe yet', async () => {
    app = await buildTestApp()

    const response = await app.inject({ method: 'GET', url: '/_/health/ready' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ready', failed: [], checks: [] })
  })

  it('picks up a check registered after the instance was built', async () => {
    app = await buildTestApp()
    app.addReadinessCheck(failing('database', 'still starting'))

    const response = await app.inject({ method: 'GET', url: '/_/health/ready' })

    expect(response.statusCode).toBe(503)
    expect(response.json().failed).toEqual(['database'])
  })

  it('is reachable without a session and without a same-origin header', async () => {
    app = await buildTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/_/health/live',
      headers: { origin: 'https://elsewhere.example' },
    })

    expect(response.statusCode).toBe(200)
  })
})
