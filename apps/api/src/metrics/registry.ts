// Prometheus instruments (spec 07 §3): HTTP requests by route and status, resolver outcomes
// and latency, session store latency, and background job outcomes, plus the Node.js
// defaults. Everything is namespaced `golinks_` so a shared Prometheus can tell it apart.

import { Counter, collectDefaultMetrics, Histogram, Registry } from '@prometheus-io/client'

export const METRICS_PREFIX = 'golinks_'

export type ResolverOutcome = 'hit' | 'miss' | 'bounce' | 'unauthenticated' | 'error'
export type SessionStoreOperation = 'get' | 'set' | 'destroy' | 'touch'
export type JobOutcome = 'succeeded' | 'failed' | 'skipped'

/** Seconds; tuned for a service whose interesting range is single-digit milliseconds. */
const LATENCY_BUCKETS = [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]

export interface ServiceMetrics {
  readonly registry: Registry
  readonly httpRequests: Counter<'method' | 'route' | 'status'>
  readonly httpDuration: Histogram<'method' | 'route' | 'status'>
  readonly resolverOutcomes: Counter<'outcome'>
  readonly resolverDuration: Histogram<'outcome'>
  readonly sessionStoreDuration: Histogram<'operation'>
  readonly jobRuns: Counter<'job' | 'outcome'>
  /** One resolver request finished with `outcome` after `seconds` of server time. */
  recordResolverOutcome(outcome: ResolverOutcome, seconds: number): void
  recordSessionStoreOperation(operation: SessionStoreOperation, seconds: number): void
  recordJobRun(job: string, outcome: JobOutcome): void
  /** The exposition text and its content type, for the scrape endpoint. */
  render(): Promise<{ contentType: string; body: string }>
}

export interface ServiceMetricsOptions {
  /** Node.js process metrics (event loop, GC, memory). On in production, off in tests. */
  collectDefaults?: boolean
}

export function createServiceMetrics(options: ServiceMetricsOptions = {}): ServiceMetrics {
  const registry = new Registry()
  if (options.collectDefaults ?? true) {
    collectDefaultMetrics({ register: registry, prefix: METRICS_PREFIX })
  }

  const httpRequests = new Counter({
    name: `${METRICS_PREFIX}http_requests_total`,
    help: 'HTTP requests handled, by method, matched route, and status.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  })
  const httpDuration = new Histogram({
    name: `${METRICS_PREFIX}http_request_duration_seconds`,
    help: 'Server time per HTTP request, by method, matched route, and status.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  })
  const resolverOutcomes = new Counter({
    name: `${METRICS_PREFIX}resolver_outcomes_total`,
    help: 'Resolver requests by outcome: hit, miss, bounce, unauthenticated, error.',
    labelNames: ['outcome'] as const,
    registers: [registry],
  })
  const resolverDuration = new Histogram({
    name: `${METRICS_PREFIX}resolver_duration_seconds`,
    help: 'Server time per resolver request, by outcome.',
    labelNames: ['outcome'] as const,
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  })
  const sessionStoreDuration = new Histogram({
    name: `${METRICS_PREFIX}session_store_duration_seconds`,
    help: 'Session store round trips, by operation.',
    labelNames: ['operation'] as const,
    buckets: LATENCY_BUCKETS,
    registers: [registry],
  })
  const jobRuns = new Counter({
    name: `${METRICS_PREFIX}job_runs_total`,
    help: 'Background job runs, by job and outcome.',
    labelNames: ['job', 'outcome'] as const,
    registers: [registry],
  })

  return {
    registry,
    httpRequests,
    httpDuration,
    resolverOutcomes,
    resolverDuration,
    sessionStoreDuration,
    jobRuns,
    recordResolverOutcome(outcome, seconds) {
      resolverOutcomes.inc({ outcome })
      resolverDuration.observe({ outcome }, seconds)
    },
    recordSessionStoreOperation(operation, seconds) {
      sessionStoreDuration.observe({ operation }, seconds)
    },
    recordJobRun(job, outcome) {
      jobRuns.inc({ job, outcome })
    },
    async render() {
      return { contentType: registry.contentType, body: await registry.metrics() }
    },
  }
}
