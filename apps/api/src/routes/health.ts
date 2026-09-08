// Liveness and readiness (spec 05 §3, spec 09 §5). Neither endpoint requires a session.

import { z } from 'zod'
import type { GoLinksApp, ReadinessCheck } from '../types.ts'

const checkResultSchema = z.object({
  name: z.string(),
  status: z.enum(['up', 'down']),
  error: z.string().optional(),
})

const readinessSchema = z.object({
  status: z.enum(['ready', 'unavailable']),
  /** Names of the checks that did not answer. Empty when the service is ready. */
  failed: z.array(z.string()),
  checks: z.array(checkResultSchema),
})

export type ReadinessReport = z.infer<typeof readinessSchema>

function reasonOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : 'the check failed'
}

/** Runs every check in parallel; one slow dependency does not hide another. */
export async function runReadinessChecks(
  checks: readonly ReadinessCheck[],
): Promise<ReadinessReport> {
  const outcomes = await Promise.allSettled(checks.map((entry) => entry.check()))

  const results = checks.map((entry, index) => {
    const outcome = outcomes[index]
    if (outcome === undefined || outcome.status === 'fulfilled') {
      return { name: entry.name, status: 'up' as const }
    }
    return { name: entry.name, status: 'down' as const, error: reasonOf(outcome.reason) }
  })

  const failed = results.filter((result) => result.status === 'down').map((result) => result.name)
  return { status: failed.length === 0 ? 'ready' : 'unavailable', failed, checks: results }
}

export function registerHealthRoutes(app: GoLinksApp): void {
  app.route({
    method: 'GET',
    url: '/_/health/live',
    schema: { response: { 200: z.object({ status: z.literal('live') }) } },
    handler: async () => ({ status: 'live' as const }),
  })

  app.route({
    method: 'GET',
    url: '/_/health/ready',
    schema: { response: { 200: readinessSchema, 503: readinessSchema } },
    handler: async (_request, reply) => {
      const report = await runReadinessChecks(app.readinessChecks())
      return reply.code(report.status === 'ready' ? 200 : 503).send(report)
    },
  })
}
