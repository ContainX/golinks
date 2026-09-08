// Wires the instruments into the app: an `onResponse` hook that counts every request
// against its matched route (never the raw URL, which for the resolver is a keyword and
// would explode label cardinality), and the scrape endpoint when it is enabled. Access to
// `/_/metrics` is not authenticated; restrict it at the network layer (spec 07 §3).

import type { GoLinksApp } from '../types.ts'
import {
  createServiceMetrics,
  type ServiceMetrics,
  type ServiceMetricsOptions,
} from './registry.ts'

export const METRICS_PATH = '/_/metrics'

/** Requests that matched no route are counted under one label rather than per URL. */
export const UNMATCHED_ROUTE = 'unmatched'

export interface MetricsPluginOptions extends ServiceMetricsOptions {
  /** Serve the scrape endpoint. Mirrors `METRICS_ENABLED`. */
  exposeEndpoint: boolean
  /** Reuse an existing instrument set (tests); otherwise one is created. */
  metrics?: ServiceMetrics
}

declare module 'fastify' {
  interface FastifyInstance {
    /** The service's Prometheus instruments; always present, scraped only when enabled. */
    metrics: ServiceMetrics
  }
}

export function registerMetrics(app: GoLinksApp, options: MetricsPluginOptions): ServiceMetrics {
  const metrics = options.metrics ?? createServiceMetrics(options)
  app.decorate('metrics', metrics)

  app.addHook('onResponse', async (request, reply) => {
    const labels = {
      method: request.method,
      route: request.routeOptions.url ?? UNMATCHED_ROUTE,
      status: String(reply.statusCode),
    }
    metrics.httpRequests.inc(labels)
    metrics.httpDuration.observe(labels, reply.elapsedTime / 1000)
  })

  if (options.exposeEndpoint) {
    app.get(METRICS_PATH, async (_request, reply) => {
      const { contentType, body } = await metrics.render()
      reply.type(contentType)
      reply.header('cache-control', 'no-store')
      return body
    })
  }

  return metrics
}
