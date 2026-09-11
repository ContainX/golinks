# 11. Browser and Short-Host Integration

Members type `go/handbook`. Making that work without a browser extension needs two things: the name `go` must resolve to the service, and the service must accept requests for that host.

## 1. DNS for the short host

Options for an organization, documented in the README:

1. Internal DNS: an `A` or `CNAME` record for the bare name `go` in the corporate DNS zone (or a search-domain entry such as `go.corp.example.com` with the search suffix configured on clients). This is the recommended path for offices and VPN users.
2. A hosts-file entry on each machine, for small teams or testing.
3. A browser search keyword using the OpenSearch descriptor (§3), which works anywhere without DNS.

The short host serves plain HTTP on port 80. Browsers treat a single-label hostname typed with a path as a URL, not a search, once it has resolved at least once; the README explains the one-time `http://go/` visit that some browsers need.

## 2. Host bounce

Requests arriving at the service with a `Host` other than the canonical host are redirected to the canonical host with the same path and query (spec 04 §2). Consequences:

- No cookies or TLS are ever needed on the short host.
- The reverse proxy must route both `go` and the canonical host to the service. TLS is only needed for the canonical host.
- `SHORT_HOST` is informational; any non-canonical host bounces.

## 3. OpenSearch descriptor

`GET /_/opensearch.xml` returns an OpenSearch description document so members can add the service as a browser search engine with the keyword `go`:

```xml
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
  <ShortName>go</ShortName>
  <Description>Go links for Acme</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="16" height="16" type="image/x-icon">https://links.example.com/favicon.ico</Image>
  <Url type="text/html" template="https://links.example.com/{searchTerms}?via=search"/>
</OpenSearchDescription>
```

The web app advertises it with `<link rel="search" type="application/opensearchdescription+xml" ...>` so browsers offer to add it. `ShortName` and `Description` use the organization's branding title when the requester is signed in.

## 4. Future clients

Designed for, not built in v1:

- Browser extension: specified in spec 12. It makes `go/...` work with no DNS through a redirect rule, adds an omnibox keyword and a popup to create a link for the current page, and borrows the member's session rather than needing a token.
- Chat integration: unfurl or expand `go/...` mentions.
- CLI: create and resolve links from the terminal.

The API surface (spec 05) and the `via` visit source are the extension points for these.
