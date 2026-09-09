// Generating and serving the OpenAPI document (spec 05 §1 and §3).
//
// `@fastify/swagger` collects routes through an `onRoute` hook, so this has to be registered
// before the first route is declared; `buildApp` calls it from the security baseline for that
// reason. The document itself is only assembled when it is asked for.
//
// No documentation viewer is served with it. The content security policy of spec 02 §7 keeps
// `script-src` to `'self'` with no inline scripts, which is exactly what the usual explorers
// need, so the document is published as data and read with whatever tool the caller prefers.

import fastifySwagger from '@fastify/swagger'
import { SERVICE_VERSION } from '../routes/me.ts'
import type { GoLinksApp } from '../types.ts'
import {
  OPENAPI_PATH,
  OPENAPI_TAGS,
  OPENAPI_VERSION,
  openApiTransform,
  openApiTransformObject,
} from './document.ts'

export { OPENAPI_PATH } from './document.ts'

/** The document changes only when the service is redeployed, so it is worth an hour. */
export const OPENAPI_CACHE_CONTROL = 'public, max-age=3600'

const DOCUMENT_TITLE = 'GoLinks API'

const DOCUMENT_DESCRIPTION = [
  'Short links resolved as `go/<keyword>` within an organization.',
  'Every request and response is JSON, and every endpoint except the document itself needs',
  'the session cookie. Failed requests carry the error envelope described by `ApiError`.',
].join(' ')

/**
 * Installs the document generator and the endpoint that serves it. Must run before any route
 * is declared: routes reach the generator through `onRoute`, which only fires from the moment
 * the plugin has loaded.
 */
export function registerOpenApi(app: GoLinksApp): void {
  const config = app.appConfig

  app.register(fastifySwagger, {
    openapi: {
      openapi: OPENAPI_VERSION,
      info: {
        title: DOCUMENT_TITLE,
        version: SERVICE_VERSION,
        description: DOCUMENT_DESCRIPTION,
      },
      servers: [{ url: config.baseUrl }],
      tags: OPENAPI_TAGS.map((tag) => ({ ...tag })),
    },
    // Paths are written as this service routes them, whatever path the base URL carries.
    stripBasePath: false,
    transform: openApiTransform,
    transformObject: openApiTransformObject,
  })

  // Queued behind the registration above, so the route is declared once every plugin of the
  // security baseline has loaded and can attach itself to it.
  app.after(() => {
    app.route({
      method: 'GET',
      url: OPENAPI_PATH,
      // Public: a description of the API is not a secret, and a client reads it before it has
      // a session to read it with.
      schema: { hide: true },
      handler: async (_request, reply) => {
        reply.header('cache-control', OPENAPI_CACHE_CONTROL)
        reply.type('application/json')
        return app.swagger()
      },
    })
  })
}
