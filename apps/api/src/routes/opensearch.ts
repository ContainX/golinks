// The OpenSearch description document (spec 11 §3). Browsers that read it can add the
// service as a search engine, so that typing `go handbook` (or `go/handbook`, depending on
// the browser) resolves the keyword without any DNS setup.

import type { GoLinksApp } from '../types.ts'

export const OPENSEARCH_PATH = '/_/opensearch.xml'
export const OPENSEARCH_CONTENT_TYPE = 'application/opensearchdescription+xml'

const DEFAULT_TITLE = 'GoLinks'

/** Escapes the five characters XML text and attribute values cannot carry literally. */
export function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export interface OpenSearchDocumentInput {
  baseUrl: string
  shortHost: string
  title: string
}

/**
 * The `{searchTerms}` placeholder must survive unencoded: it is the OpenSearch template
 * syntax, not part of the URL. The `via=search` marker lets visit records tell search-bar
 * traffic apart (spec 04 §6).
 */
export function renderOpenSearchDocument({
  baseUrl,
  shortHost,
  title,
}: OpenSearchDocumentInput): string {
  const origin = baseUrl.replace(/\/+$/, '')
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">',
    `  <ShortName>${escapeXml(shortHost)}</ShortName>`,
    `  <Description>${escapeXml(`Go links for ${title}`)}</Description>`,
    '  <InputEncoding>UTF-8</InputEncoding>',
    `  <Image width="16" height="16" type="image/x-icon">${escapeXml(`${origin}/favicon.ico`)}</Image>`,
    `  <Url type="text/html" template="${escapeXml(origin)}/{searchTerms}?via=search"/>`,
    '</OpenSearchDescription>',
    '',
  ].join('\n')
}

export function registerOpenSearchRoute(app: GoLinksApp): void {
  app.get(OPENSEARCH_PATH, async (request, reply) => {
    let title = DEFAULT_TITLE
    if (request.member !== null) {
      const settings = await app.organizationSettings.getSettings(request.member.organizationId)
      title = settings.branding.title
    }
    reply.type(OPENSEARCH_CONTENT_TYPE)
    reply.header('cache-control', 'private, max-age=3600')
    return renderOpenSearchDocument({
      baseUrl: app.appConfig.baseUrl,
      shortHost: app.appConfig.shortHost,
      title,
    })
  })
}
