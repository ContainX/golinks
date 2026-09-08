/**
 * Plumbing every resource module shares.
 *
 * A resource module turns one endpoint of spec 05 §3 into a function. Two
 * things happen around every such call, and both are done here so that no
 * resource module has to remember them:
 *
 * - the request's query string is built from the endpoint's shared query
 *   schema, so a parameter the API would reject never leaves the browser;
 * - the response is parsed with the endpoint's shared response schema, so a
 *   payload that does not match the contract is reported as such instead of
 *   spreading `undefined` through the app.
 */

import type { z } from 'zod'
import type { ApiFetchInit } from './http.ts'

/**
 * What a caller may say about a single request. React Query hands its query
 * functions an {@link AbortSignal}; passing it through lets a superseded
 * request be cancelled.
 */
export interface RequestOptions {
  signal?: AbortSignal | undefined
  /**
   * Whether a 401 sends the browser to sign-in (spec 02 §2). On by default;
   * see {@link ApiFetchInit.redirectOnUnauthenticated}.
   */
  redirectOnUnauthenticated?: boolean | undefined
}

/** Folds {@link RequestOptions} into the transport's own init object. */
export function requestInit(options: RequestOptions, init: ApiFetchInit = {}): ApiFetchInit {
  return {
    ...init,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.redirectOnUnauthenticated === undefined
      ? {}
      : { redirectOnUnauthenticated: options.redirectOnUnauthenticated }),
  }
}

/**
 * A response the API sent that does not match the shared schema for the
 * resource: a field missing, a timestamp that is not one, a list where an
 * object was promised. It means the client and the API disagree about the
 * contract, so it is raised rather than papered over.
 */
export class ResponseValidationError extends Error {
  /** The resource that was expected, for example `Link` or `Me`. */
  readonly resource: string
  readonly issues: z.ZodError['issues']
  /** The body as it arrived, for a report to whoever deployed the mismatch. */
  readonly body: unknown

  constructor(resource: string, error: z.ZodError, body: unknown) {
    super(`The API returned a ${resource} that does not match the schema.\n${prettyIssues(error)}`)
    this.name = 'ResponseValidationError'
    this.resource = resource
    this.issues = error.issues
    this.body = body
  }
}

/**
 * Request parameters or a request body the API would refuse. Raised before the
 * request is sent, because the shared schemas are the same ones the API
 * validates with, so the answer is already known here.
 */
export class RequestValidationError extends Error {
  /** What was being built, for example `GET /links` or a `Link` create body. */
  readonly resource: string
  readonly issues: z.ZodError['issues']

  constructor(resource: string, error: z.ZodError) {
    super(`${resource} was called with values the API would reject.\n${prettyIssues(error)}`)
    this.name = 'RequestValidationError'
    this.resource = resource
    this.issues = error.issues
  }
}

function prettyIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.')
      return path.length === 0 ? issue.message : `${path}: ${issue.message}`
    })
    .join('\n')
}

/** Parses a response body with the shared schema for that resource. */
export function parseResponse<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  resource: string,
): z.output<Schema> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new ResponseValidationError(resource, result.error, body)
  }
  return result.data
}

/** Parses a request body with the shared schema, applying its defaults. */
export function parseRequestBody<Schema extends z.ZodType>(
  schema: Schema,
  body: unknown,
  resource: string,
): z.output<Schema> {
  const result = schema.safeParse(body)
  if (!result.success) {
    throw new RequestValidationError(resource, result.error)
  }
  return result.data
}

/**
 * Turns a parameter object into query-string pairs.
 *
 * `undefined`, `null`, and the empty string all mean "no such filter" and are
 * dropped: a cleared search box must produce the same request, and the same
 * cache key, as one that was never typed in.
 */
function queryEntries(params: Record<string, unknown>): [string, string][] {
  const entries: [string, string][] = []
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') {
      continue
    }
    entries.push([name, String(value)])
  }
  entries.sort(([a], [b]) => a.localeCompare(b))
  return entries
}

/**
 * Builds the query string for an endpoint and checks it against that
 * endpoint's shared schema first.
 *
 * The schemas parse query strings — every value arrives as text — so the
 * serialized form is what gets validated, exactly as the API will see it.
 * Values the caller did not supply are left out rather than sent as the
 * schema's defaults, keeping the request as short as what was asked for.
 *
 * Returns `''` or a string beginning with `?`, ready to append to a path.
 */
export function buildQuery<Schema extends z.ZodType>(
  schema: Schema,
  params: Record<string, unknown>,
  resource: string,
): string {
  const entries = queryEntries(params)
  const result = schema.safeParse(Object.fromEntries(entries))
  if (!result.success) {
    throw new RequestValidationError(resource, result.error)
  }
  if (entries.length === 0) {
    return ''
  }
  return `?${new URLSearchParams(entries).toString()}`
}
