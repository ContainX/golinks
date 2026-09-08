import { describe, expect, it } from 'vitest'
import { buildTestApp } from '../testing/fixtures.ts'

describe('metrics', () => {
  it('counts requests by matched route and serves the scrape endpoint when enabled', async () => {
    const app = await buildTestApp({ environment: { METRICS_ENABLED: 'true' } })

    await app.inject({ method: 'GET', url: '/_/health/live' })
    await app.inject({ method: 'GET', url: '/_/health/live' })
    await app.inject({ method: 'GET', url: '/some-keyword' })
    app.metrics.recordJobRun('visit-retention', 'succeeded')

    const response = await app.inject({ method: 'GET', url: '/_/metrics' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/plain')
    const body = response.body
    expect(body).toMatch(
      /golinks_http_requests_total\{method="GET",route="\/_\/health\/live",status="200"\} 2/,
    )
    // The resolver catch-all is a single route: keywords never become label values. An
    // anonymous keyword request is a redirect to sign-in (spec 04 §3).
    expect(body).toMatch(/golinks_http_requests_total\{method="GET",route="\/\*",status="302"\} 1/)
    expect(body).not.toContain('some-keyword')
    expect(body).toMatch(/golinks_resolver_outcomes_total\{outcome="unauthenticated"\} 1/)
    expect(body).toMatch(/golinks_job_runs_total\{job="visit-retention",outcome="succeeded"\} 1/)
    // Process collectors are on when metrics are enabled.
    expect(body).toContain('golinks_process_cpu_seconds_total')
    await app.close()
  })

  it('counts a bounced keyword request once, as a bounce', async () => {
    const app = await buildTestApp()
    await app.inject({ method: 'GET', url: '/handbook', headers: { host: 'go' } })
    const body = (await app.metrics.render()).body
    expect(body).toMatch(/golinks_resolver_outcomes_total\{outcome="bounce"\} 1/)
    expect(body).not.toMatch(/golinks_resolver_outcomes_total\{outcome="hit"\}/)
    await app.close()
  })

  it('keeps the instruments but hides the endpoint when disabled', async () => {
    const app = await buildTestApp()
    await app.inject({ method: 'GET', url: '/_/health/live' })
    expect((await app.metrics.render()).body).toContain('golinks_http_requests_total')
    const response = await app.inject({ method: 'GET', url: '/_/metrics' })
    expect(response.statusCode).toBe(404)
    await app.close()
  })
})
