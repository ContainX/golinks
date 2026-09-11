# 03. Links

## 1. Data model

Table `links`:

| Column | Type | Notes |
|---|---|---|
| id | bigint identity, primary key | |
| organization_id | text, FK organizations | |
| namespace | text | Stored literally, including the default namespace |
| keyword | text | Canonical form (§2.2) |
| display_keyword | text | Normalized as entered (§2.1); differs from `keyword` only in punctuation-insensitive organizations |
| keyword_prefix | text | First segment of `keyword` |
| segment_count | smallint | Number of segments |
| placeholder_count | smallint | Number of `%s` segments; > 0 means programmatic |
| destination | text | Up to 4096 characters, as stored after §3 |
| owner_id | bigint, FK users | |
| is_unlisted | boolean, default false | |
| visit_count | bigint, default 0 | Maintained per spec 07 |
| last_visited_at | timestamptz | |
| created_by_id | bigint, FK users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

Constraints and indexes:

- `UNIQUE (organization_id, namespace, keyword)`
- `INDEX (organization_id, namespace, keyword_prefix)` for pattern and prefix lookups
- `INDEX (organization_id, owner_id)`
- Trigram GIN indexes on `display_keyword` and `destination` (`pg_trgm`) for search and suggestions

Ownership is a foreign key to `users`. A link can only be owned by an existing member of the same organization. Users are never deleted (spec 01 §2.4), so the key never dangles.

Because the default namespace is stored literally, changing an organization's default namespace rewrites the `namespace` column of its affected links in one transaction (spec 06 §3).

## 2. Keyword rules

### 2.1 Normalization

Applied to any keyword received from a client, in order:

1. Trim whitespace.
2. Lowercase.
3. Remove leading and trailing `/`.
4. Reject if empty, if any segment is empty (`a//b`), if longer than 200 characters, or if it has more than 10 segments.

The result is the display keyword.

### 2.2 Canonical form

If the organization's `keywords.punctuationSensitive` setting is false, the canonical keyword is the display keyword with every ASCII punctuation character except `/` and `%` removed from each segment. `meeting-notes/2026-09` becomes `meetingnotes/202609`. If any segment becomes empty, the keyword is invalid.

If the setting is true (the default), the canonical keyword equals the display keyword.

Lookups, uniqueness, and conflict checks use the canonical keyword. The directory shows the display keyword.

### 2.3 Allowed characters

The display keyword MUST match the organization's `keywords.allowedPattern` regular expression. The default is:

```
^[a-z0-9-]+(/([a-z0-9-]+|%s))*$
```

That is: segments of lowercase letters, digits, and hyphens, or a `%s` placeholder segment. Admins may loosen the pattern (for example to allow `.` or `_`), subject to these invariants that always hold regardless of the pattern:

- The keyword MUST NOT start with `_`. Paths under `/_/` belong to the application.
- `%` MUST only appear as part of a `%s` placeholder segment.
- Segments are separated by exactly one `/`.

### 2.4 Placeholders

- A placeholder is a segment that is exactly `%s`.
- The first segment MUST NOT be a placeholder.
- Once a placeholder segment appears, every following segment MUST also be a placeholder. `jira/%s`, `gh/%s/%s`, and `docs/api/%s` are valid; `gh/%s/issues` is not.
- The number of placeholder segments MUST equal the number of `%s` occurrences in the destination.
- Under the `prefixFallback` resolution mode (spec 04 §5), the second segment, when present, MUST be `%s`. Hierarchical keywords are not available in that mode.

### 2.5 Reserved prefixes

- `_` is reserved (§2.3).
- When creating a keyword with two or more segments in the default namespace, the first segment MUST NOT equal any configured namespace of the organization. Otherwise `go/eng/deploy` could mean either the keyword `eng/deploy` in `go` or the keyword `deploy` in `eng`. The error code is `namespace_reserved`. A single-segment keyword named after a namespace (`go/eng`) is allowed: a request for `/eng` has no remainder, so it always means the default-namespace keyword (spec 04 §4).
- When an admin adds a namespace whose name is already the first segment of existing default-namespace keywords, the settings update is rejected with `namespace_conflicts` listing those links (spec 06 §3).

## 3. Destination rules

1. Trim whitespace.
2. If the value has no scheme (`^[a-zA-Z][a-zA-Z0-9+.-]*:` does not match, or the match is not followed by `//`), prepend `https://`.
3. Parse with the WHATWG URL parser. Parsing MUST succeed.
4. The scheme MUST be `http` or `https`. `javascript:`, `data:`, `file:`, and everything else are rejected.
5. The host MUST be non-empty. Single-label intranet hostnames (`wiki`), IP addresses, and internationalized domain names are all valid.
6. Length after step 2 MUST be at most 4096 characters.
7. Count `%s` occurrences for the placeholder rule (§2.4).

The stored destination is the trimmed value after step 2, not the parser's re-serialized form, so that what the owner typed is what the directory shows. At redirect time the value is substituted and then serialized through the URL parser, which percent-encodes non-ASCII characters and converts IDNs to their ASCII form for the `Location` header (spec 04 §7).

A destination MAY point back at this service. The resolver does not follow it; the browser's own redirect limit stops accidental loops.

## 4. Visibility

- Listed links appear in the directory, in search, and in suggestions for every member of the organization.
- Unlisted links resolve for every member of the organization but appear in the directory, search, and suggestions only for their owner and for admins. The filter is applied in SQL, never after loading rows.
- Nothing is ever visible across organizations.

## 5. Permissions

| Action | Owner | Admin (same org) | Other member |
|---|---|---|---|
| See a listed link | yes | yes | yes |
| See an unlisted link in the directory | yes | yes | no |
| Resolve any link | yes | yes | yes |
| Create a link | yes | yes, may set `ownerId` | yes |
| Edit destination | yes | yes | only when `editMode` is `anyMember` |
| Edit keyword, namespace, or unlisted flag | yes | yes | no |
| Delete | yes | yes | no |
| Create a transfer link | yes | yes | no |
| Accept a transfer link | any enabled member of the organization holding a valid token | | |
| Set owner directly | no | yes | no |

When the organization is in read-only mode (spec 06), members other than admins cannot create, edit, delete, or transfer links. Resolution is unaffected.

Permission failures return 403 with code `forbidden`. A request for a link in another organization returns 404, not 403, so that ids do not leak existence across tenants.

## 6. Creating a link

Input: `namespace` (defaults to the organization's default namespace), `keyword`, `destination`, `isUnlisted` (default false), and `ownerId` (admins only; defaults to the caller).

Validation order:

1. `namespace` is the default namespace or one of the organization's namespaces; else `namespace_invalid`.
2. Keyword rules (§2); errors `keyword_invalid`, `keyword_reserved`, `namespace_reserved`, `placeholder_invalid`.
3. Destination rules (§3); errors `destination_invalid`, `placeholder_count_mismatch`.
4. Read-only mode for non-admins; error `read_only`.
5. `ownerId`, when given, is an enabled member of the same organization; else `owner_invalid`.
6. Conflict detection (§6.1).
7. Insert, then emit `link.created` (spec 07).

The response is the created link. Errors carry an `existingLink` when a conflicting link exists (spec 05 §4).

### 6.1 Conflict detection

All checks are within the same organization and namespace, on canonical keywords.

1. An identical canonical keyword exists: `keyword_exists`.
2. The new keyword would resolve to an existing programmatic link through pattern matching (spec 04 §4). Example: creating `jira/abc` when `jira/%s` exists: `keyword_conflict`.
3. The new keyword is programmatic and an existing link has the same segment count where every segment pair is either equal or has a placeholder on at least one side. Example: creating `jira/%s` when `jira/abc` exists, or creating `gh/%s/%s` when `gh/%s/%s` exists under a different display form: `keyword_conflict`.
4. In `prefixFallback` mode, a single-segment keyword and any programmatic keyword sharing that first segment conflict in both directions. Example: `example` versus `example/%s`.

Creation and rename run inside a transaction that takes a transaction-scoped advisory lock keyed on `(organization_id, namespace, keyword_prefix)` before the checks, so that concurrent requests cannot both pass. The unique index is the final backstop for check 1.

## 7. Updating a link

`PATCH` accepts any subset of `destination`, `keyword`, `namespace`, `isUnlisted`, and `ownerId`, subject to the permission table. Changing `keyword` or `namespace` re-runs the full keyword validation and conflict detection, excluding the link itself. Changing `ownerId` follows §9.1.

Every update emits `link.updated` with the changed fields and their previous values.

## 8. Deleting a link

Deletion is permanent. Visit records for the link are deleted with it (spec 07). A `link.deleted` event carrying a snapshot of the link is emitted first, so the audit trail keeps the history.

## 9. Ownership transfer

### 9.1 Direct assignment

An admin sets `ownerId` to any enabled member of the organization. Emits `link.transferred`.

### 9.2 Transfer links

A transfer link lets an owner hand a link to a colleague without an admin and without a user picker.

Table `link_transfers`:

| Column | Notes |
|---|---|
| id | bigint identity |
| link_id | FK links, cascade on delete |
| token_hash | SHA-256 of the token; the token itself is never stored |
| created_by_id | FK users |
| expected_owner_id | The link's owner at creation time |
| expires_at | Creation time plus `TRANSFER_TOKEN_TTL` (default 24 hours) |
| accepted_by_id, accepted_at | Set on acceptance |
| revoked_at | Set when superseded or revoked |
| created_at | |

Creating a transfer (`POST /_/api/v1/links/:id/transfers`, owner or admin):

- Generate a 32-byte random token, base64url encoded. Store its hash. Revoke any other pending transfer for the same link.
- Respond with `{ id, url, expiresAt }` where `url` is `<BASE_URL>/_/transfer/<token>`.

Accepting (`POST /_/api/v1/transfers/:token/accept`, any signed-in member) validates, in order, and fails with the given code:

1. Token hash exists: `transfer_invalid`.
2. Not expired: `transfer_expired`.
3. Not already accepted or revoked: `transfer_invalid`.
4. Link still exists: `transfer_invalid`.
5. The link's current owner equals `expected_owner_id`: `transfer_owner_changed`.
6. The creator still has edit rights on the link (is its owner or an admin of the organization, and is enabled): `transfer_creator_lost_access`.
7. The accepting member belongs to the link's organization and is enabled: `transfer_invalid` (404 semantics, no cross-tenant leak).
8. The accepting member is not already the owner: `transfer_already_owner`.
9. The organization is not in read-only mode, or the accepting member is an admin: `read_only`. A token minted before a freeze stays valid until the freeze lifts.

On success the owner becomes the accepting member, the transfer is marked accepted, and `link.transferred` is emitted. `GET /_/api/v1/transfers/:token` returns a preview (link summary, expiry, status) for the acceptance page and applies checks 1 through 7 without mutating.

## 10. Listing, search, and suggestions

### 10.1 Listing

`GET /_/api/v1/links` supports:

| Parameter | Meaning |
|---|---|
| q | Case-insensitive substring match against `display_keyword`, `destination`, and the owner's email |
| namespace | Restrict to one namespace |
| destination | Exact match on the stored destination, for "is there a link for this page" (spec 12) |
| owner | `me` or a user id |
| programmatic | `true`, `false`, or omitted for both |
| sort | `visits` (default, descending), `keyword`, `created`, `updated` |
| order | `asc` or `desc` |
| limit | Default 50, maximum 200 |
| cursor | Opaque cursor from the previous page |

The unlisted filter from §4 always applies for the viewer. Responses include `permissions` per link so the UI can enable or disable actions without recomputing rules.

### 10.2 Suggestions

`GET /_/api/v1/links/suggestions?keyword=<k>&namespace=<ns>&limit=5` returns links in the namespace ranked by trigram similarity between their canonical keyword and the canonical form of `<k>`, above `SUGGESTION_MIN_SIMILARITY` (default 0.3), excluding an exact match. The unlisted filter applies. The resolver's miss flow (spec 04 §8) sends members to a page that calls this endpoint.
