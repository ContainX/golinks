// Small URL helpers used by the configuration schema. They are hand written rather than built
// on the WHATWG parser so that this module compiles without DOM or Node type libraries and
// stays usable from the web app.

const ORIGIN_PATTERN = /^(https?):\/\/(\[[0-9a-fA-F:.]+\]|[^\s/?#:@[\]]+)(?::(\d{1,5}))?\/?$/

const DEFAULT_PORTS: Record<string, string> = { 'http:': '80', 'https:': '443' }

export interface HttpOrigin {
  /** `http:` or `https:`. */
  protocol: string
  /** Lowercased host without a port. */
  hostname: string
  /** Host with the port, when the port is not the scheme default. */
  host: string
  /** `<protocol>//<host>`, never with a trailing slash. */
  origin: string
}

/**
 * Parses an absolute http(s) origin. Returns undefined when the text carries a path, query,
 * fragment, credentials, or anything else that an origin may not have.
 */
export function parseHttpOrigin(value: string): HttpOrigin | undefined {
  const match = ORIGIN_PATTERN.exec(value.trim())
  if (!match) return undefined
  const [, scheme, authority, port] = match
  if (scheme === undefined || authority === undefined) return undefined

  const protocol = `${scheme.toLowerCase()}:`
  const hostname = authority.toLowerCase()
  if (port !== undefined) {
    const numeric = Number(port)
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) return undefined
  }
  const isDefaultPort = port === undefined || port === DEFAULT_PORTS[protocol]
  const host = isDefaultPort ? hostname : `${hostname}:${Number(port)}`

  return { protocol, hostname, host, origin: `${protocol}//${host}` }
}

/** The origin of an absolute request URL, for the Origin and Referer checks of spec 02 §6. */
export function originOfUrl(value: string): string | undefined {
  const withoutTail = value.trim().replace(/[?#].*$/, '')
  const separator = withoutTail.indexOf('://')
  if (separator === -1) return undefined
  const pathStart = withoutTail.indexOf('/', separator + 3)
  const origin = pathStart === -1 ? withoutTail : withoutTail.slice(0, pathStart)
  return parseHttpOrigin(origin)?.origin
}
