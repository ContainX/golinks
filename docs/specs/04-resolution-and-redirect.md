# 04. Resolution and Redirect

The resolver owns every request whose path does not start with `/_/` and is not one of the few fixed files in §1. It is the hot path.

## 1. Route ownership

| Path | Owner |
|---|---|
| `/` | Web app (directory) |
| `/_/**` | Web app routes, API, auth, assets, health |
| `/favicon.ico`, `/robots.txt` | Static files served directly, never treated as keywords |
| Everything else | Resolver |

The resolver answers `GET` and `HEAD` only. Other methods receive 405.

## 2. Short-host bounce

If the request's `Host` (or `X-Forwarded-Host` when `TRUST_PROXY` is on) is not the canonical host from `BASE_URL`, the resolver responds 302 to `<BASE_URL><original path and query>` without touching the session. This is how `http://go/handbook` becomes `https://links.example.com/handbook`: the short host never needs cookies or TLS, and the canonical host does all the work. See spec 11.

The bounce applies to `/` and `/_/**` as well, so a member who types `go/` lands on the directory.

## 3. Authentication gate

If no valid session is present, respond 302 to `/_/auth/login?redirectTo=<path and query>`. After sign-in the member returns to the same path and resolution continues. `redirectTo` is sanitized per spec 02 §2.2.

## 4. Parsing the request

Given the decoded request path (percent-decoded, surrounding `/` removed):

1. Split on the first `/` into `head` and `rest` (`rest` may be empty).
2. Lowercase `head`. Do not lowercase `rest`; placeholder values keep their case.
3. Canonicalize `head` using the organization's punctuation rule (spec 03 §2.2). Do not canonicalize `rest` yet; a placeholder value may legitimately contain punctuation.
4. Namespace detection: if `rest` is non-empty and `head` is one of the organization's configured namespaces, then `namespace = head` and the keyword path is `rest`. Otherwise `namespace` is the default namespace and the keyword path is `head/rest` (or just `head`).
5. Split the keyword path into segments.

## 5. Resolution algorithm

Within `(organization, namespace)`, try in order and stop at the first hit:

### 5.1 Exact match

Canonicalize every segment and join. Look up the canonical keyword in the unique index. Hit: destination is the stored destination.

### 5.2 Pattern match

Only when there are at least two segments. Load programmatic links whose `keyword_prefix` equals the canonical first segment and whose `segment_count` equals the request's segment count. For each, ordered by keyword ascending for determinism, compare segment by segment: a `%s` segment captures the raw request segment; any other segment must equal the canonicalized request segment. The first link where every segment matches is the hit. Destination is the stored destination with each `%s` replaced positionally by the captured values, percent-encoded as URL components (§7).

### 5.3 Prefix fallback

Only when the organization's `keywords.resolutionMode` is `prefixFallback`.

- Two or more segments: look up the canonical first segment as an exact keyword. Hit: destination is the stored destination followed by `/` and the raw remainder of the request path joined by `/`.
- One segment: load programmatic links with that `keyword_prefix`. If any exist, take the first ordered by keyword ascending (log a warning if there is more than one) and use its destination with every `%s` replaced by the empty string.

### 5.4 Miss

No hit: go to §8.

## 6. Recording the visit

On a hit, after the redirect response has been sent, record the visit (spec 07): increment `visit_count`, set `last_visited_at`, and insert a `link_visits` row with the member, the timestamp, and the access source. The access source comes from the optional `via` query parameter on the request (`browser` default, `search` from the OpenSearch template, `ext`, `api`). Any other query parameters on the request are ignored and not forwarded.

Recording MUST NOT delay or fail the redirect. Failures are logged.

## 7. Building the redirect

- Substitute placeholder values into the stored destination string first, each encoded with `encodeURIComponent`. Then parse the result with the WHATWG URL parser and use its serialized `href` as the `Location` value. This yields an ASCII-safe header: non-ASCII characters are percent-encoded and IDN hosts become their ASCII form.
- If serialization fails (which can only happen for a stored destination that predates a rule change), respond 502 with a small error page naming the link and its owner rather than redirecting to garbage, and log it.
- Status 302. Never 301: destinations change and 301s are cached by browsers.
- Headers: `Location`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer`.

## 8. Miss behavior

Respond 302 to the web app's directory with the typed keyword pre-filled:

```
/_/?keyword=<display form of the keyword path>&namespace=<ns>
```

`namespace` is omitted when it is the default. The display form preserves the punctuation the member typed so that the creation form shows what they meant. The web app calls the suggestions endpoint (spec 03 §10.2) to offer similar existing links, and the creation form is pre-filled. The exact experience is part of the UX design (spec 08).

## 9. Worked examples

Organization `acme.com`, default namespace `go`, extra namespace `eng`, punctuation-sensitive, standard resolution mode. Links:

| Namespace | Keyword | Destination |
|---|---|---|
| go | handbook | https://wiki.acme.com/handbook |
| go | jira/%s | https://acme.atlassian.net/browse/%s |
| go | gh/%s/%s | https://github.com/acme/%s/issues/%s |
| go | meeting-notes | https://docs.acme.com/notes |
| eng | deploy | https://deploy.acme.com |

| Request path | Result |
|---|---|
| `/handbook` | 302 https://wiki.acme.com/handbook |
| `/Handbook` | Same; first segment is lowercased |
| `/handbook/` | Same; trailing slash removed |
| `/jira/ACME-123` | 302 https://acme.atlassian.net/browse/ACME-123 (case preserved) |
| `/jira/a b` (typed as `a%20b`) | 302 https://acme.atlassian.net/browse/a%20b |
| `/gh/web/42` | 302 https://github.com/acme/web/issues/42 |
| `/gh/web` | Miss: segment count differs |
| `/jira` | Miss in standard mode. In `prefixFallback` mode: 302 https://acme.atlassian.net/browse/ |
| `/handbook/extra` | Miss in standard mode. In `prefixFallback` mode: 302 https://wiki.acme.com/handbook/extra |
| `/eng/deploy` | 302 https://deploy.acme.com (namespace `eng`) |
| `/eng/nothing` | Miss: 302 `/_/?keyword=nothing&namespace=eng` |
| `/eng` | No remainder, so treated as keyword `eng` in `go`, which does not exist: miss. Creating `go/eng` is allowed. |
| `/nothing-here` | Miss: 302 `/_/?keyword=nothing-here` |
| `/meetingnotes` | Miss while punctuation-sensitive; a hit if the organization is punctuation-insensitive |
| `/_/anything` | Never reaches the resolver |
| `POST /handbook` | 405 |

Same organization, punctuation-insensitive: `meeting-notes` is stored canonically as `meetingnotes`, and `/meeting-notes`, `/meetingnotes`, and `/MEETING_NOTES` all hit. A request for `/jira/2026-roadmap` still passes `2026-roadmap` through unchanged as the placeholder value.

## 10. Performance targets

- Server time on a hit with a warm session: p50 under 10 ms, p99 under 50 ms, excluding network.
- At most three database round trips on the hot path: session and user (or one Redis read), organization settings (cached, spec 06 §4), and the link lookup(s). The exact match and the pattern query MAY be combined into one round trip.
- Visit recording is off the critical path (§6).
- Sessions in Redis when available (spec 02 §3).

Measured: `pnpm --filter @golinks/api exec tsx scripts/bench-resolver.ts` seeds 5,000 links in
one organization, signs a member in, and drives 2,000 warm hits through the app (300 warm-up
hits first) against the embedded Postgres the integration harness starts. Server time p50
0.52 ms and p99 1.56 ms, excluding network. Three SQL statements per hit, every hit: the session
read, the exact-match link lookup, and the session save that slides the cookie's expiry. The
organization's settings cost nothing, being served from the in-process cache (§11). A deployment
with `REDIS_URL` set trades the two session statements for one Redis read.

## 11. Caching

Organization settings are cached in-process for 30 seconds and in Redis, when configured, for 5 minutes, invalidated on write. Link lookups are not cached in v1: they hit a unique index and caching would only add invalidation risk. Revisit if measurements say otherwise.
