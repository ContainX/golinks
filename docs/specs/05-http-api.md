# 05. HTTP API

Base path: `/_/api/v1`. All requests and responses are JSON. Authentication is the session cookie (spec 02). Every endpoint except health requires a session; admin endpoints require the admin role.

Request and response shapes are defined once as zod schemas in the shared package and reused by the API for validation and by the web app for types. An OpenAPI document is generated from them and served at `/_/api/v1/openapi.json`.

## 1. Conventions

- Ids are strings in JSON.
- Timestamps are ISO 8601 UTC strings.
- Lists return `{ "items": [...], "nextCursor": string | null }`.
- Field names are camelCase.
- Unknown request fields are rejected (400 `validation_failed`).
- Every response carries `X-Request-Id`; clients SHOULD include it when reporting problems.

## 2. Resources

### 2.1 Link

```json
{
  "id": "42",
  "namespace": "go",
  "keyword": "meetingnotes",
  "displayKeyword": "meeting-notes",
  "fullPath": "go/meeting-notes",
  "destination": "https://docs.acme.com/notes",
  "isProgrammatic": false,
  "placeholderCount": 0,
  "isUnlisted": false,
  "owner": { "id": "7", "email": "jane@acme.com" },
  "visitCount": 128,
  "lastVisitedAt": "2026-09-07T14:03:00Z",
  "createdAt": "2026-01-10T09:00:00Z",
  "updatedAt": "2026-08-30T16:20:00Z",
  "permissions": { "canEditDestination": true, "canEdit": true, "canDelete": true, "canTransfer": true }
}
```

`permissions` is computed for the requesting member (spec 03 §5).

### 2.2 Me

```json
{
  "user": { "id": "7", "email": "jane@acme.com", "role": "admin", "organizationId": "acme.com", "preferences": {}, "createdAt": "..." },
  "organization": {
    "id": "acme.com",
    "defaultNamespace": "go",
    "namespaces": ["eng"],
    "keywords": { "allowedPattern": "^[a-z0-9-]+(/([a-z0-9-]+|%s))*$", "punctuationSensitive": true, "resolutionMode": "standard" },
    "editMode": "ownersAndAdmins",
    "readOnly": false,
    "banner": null,
    "branding": { "title": "GoLinks", "logoUrl": null, "faviconUrl": null, "primaryColor": null, "secondaryColor": null, "light": {}, "dark": {} },
    "navigationLinks": []
  },
  "app": { "baseUrl": "https://links.example.com", "shortHost": "go", "version": "1.0.0", "managedSettings": ["branding.title"] }
}
```

`app.managedSettings` lists the dotted settings paths the deployment fixes for every organization (spec 06 §6), sorted; `[]` when it fixes none. The values are already applied to `organization`, and `PUT /admin/settings` refuses a document that changes one of them, so the admin screen shows those fields as read-only.

### 2.3 User (admin view)

```json
{ "id": "7", "email": "jane@acme.com", "role": "admin", "roleSource": "idp", "isEnabled": true, "linkCount": 12, "lastLoginAt": "...", "createdAt": "..." }
```

### 2.4 Transfer

```json
{ "id": "3", "url": "https://links.example.com/_/transfer/<token>", "expiresAt": "..." }
```

Preview (`GET /transfers/:token`):

```json
{ "status": "pending", "link": { "id": "42", "fullPath": "go/meeting-notes", "destination": "...", "owner": { "id": "7", "email": "jane@acme.com" } }, "expiresAt": "..." }
```

`status` is `pending`, `expired`, `accepted`, `revoked`, or `invalid`.

## 3. Endpoints

### Session and profile

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Current member, organization settings, app info (§2.2) |
| PATCH | `/me` | Body `{ "preferences": {...} }`. Whitelisted keys only. Returns Me. |

### Links

| Method | Path | Notes |
|---|---|---|
| GET | `/links` | Query parameters per spec 03 §10.1. Returns a list of Link. |
| POST | `/links` | Body `{ namespace?, keyword, destination, isUnlisted?, ownerId? }`. 201 with Link. |
| GET | `/links/suggestions` | Query `keyword`, `namespace?`, `limit?`. Returns `{ "items": [Link] }`. Declared before `/links/:id`. |
| GET | `/links/:id` | Link |
| PATCH | `/links/:id` | Body: any subset of `destination`, `keyword`, `namespace`, `isUnlisted`, `ownerId`. Returns Link. |
| DELETE | `/links/:id` | 204 |
| POST | `/links/:id/transfers` | 201 with Transfer |

### Transfers

| Method | Path | Notes |
|---|---|---|
| GET | `/transfers/:token` | Preview (§2.4) |
| POST | `/transfers/:token/accept` | Returns the Link with its new owner |

### Admin

| Method | Path | Notes |
|---|---|---|
| GET | `/admin/users` | Query `q?`, `role?`, `enabled?`, `limit?`, `cursor?`. List of User. |
| GET | `/admin/users/:id` | User |
| PATCH | `/admin/users/:id` | Body: subset of `{ isEnabled, role }`. Sets `roleSource` to `manual` when `role` changes. |
| GET | `/admin/settings` | Organization settings object (spec 06 §2) |
| PUT | `/admin/settings` | Full settings object. Validated; namespace conflicts return 409 `namespace_conflicts`. |
| GET | `/admin/events` | Query `type?`, `linkId?`, `userId?`, `limit?`, `cursor?`. Audit events (spec 07). |

### Non-API routes under `/_/`

| Method | Path | Notes |
|---|---|---|
| GET | `/_/health/live` | 200 when the process is up |
| GET | `/_/health/ready` | 200 when Postgres (and Redis, if configured) answer; 503 otherwise |
| GET | `/_/opensearch.xml` | OpenSearch description document (spec 11) |
| GET | `/_/auth/providers` | Public. `{ providers: [{ id, label, iconUrl }], testSignIn }` for the sign-in page. |
| GET | `/_/auth/*` | Spec 02 |
| GET | `/_/branding/*` | Public. Files from the deployment's `<CONFIG_DIR>/branding` (spec 06 §6), cached for an hour. No directory listing, no dotfiles; a name that is not there is 404 in the error envelope. |
| GET | `/_/api/v1/openapi.json` | Generated OpenAPI document |

## 4. Errors

Shape:

```json
{ "error": { "code": "keyword_exists", "message": "go/handbook already exists.", "details": {}, "existingLink": { ...Link } } }
```

`existingLink` is present only for `keyword_exists` and `keyword_conflict`. `details` carries field-level validation messages for `validation_failed` as `{ "fields": { "destination": "..." } }`.

| HTTP | Code | When |
|---|---|---|
| 400 | validation_failed | Schema validation failed |
| 400 | keyword_invalid | Fails normalization or allowed pattern |
| 400 | keyword_reserved | Starts with `_` |
| 400 | namespace_invalid | Not a namespace of the organization |
| 400 | namespace_reserved | First segment collides with a namespace (spec 03 §2.5) |
| 400 | placeholder_invalid | Placeholder position rules (spec 03 §2.4) |
| 400 | placeholder_count_mismatch | Keyword and destination disagree |
| 400 | destination_invalid | Spec 03 §3 |
| 400 | owner_invalid | `ownerId` not an enabled member of the organization |
| 400 | cannot_modify_self | Admin disabling or demoting themselves |
| 401 | unauthenticated | No valid session |
| 403 | forbidden | Permission table denies the action |
| 403 | read_only | Organization is read-only and the caller is not an admin |
| 403 | csrf_origin_mismatch | Spec 02 §6 |
| 404 | not_found | Missing, or belongs to another organization |
| 405 | method_not_allowed | Resolver paths accept only GET and HEAD |
| 409 | keyword_exists | Exact canonical keyword exists |
| 409 | keyword_conflict | Pattern or prefix conflict |
| 409 | namespace_conflicts | Settings change collides with existing keywords |
| 409 | namespace_in_use | Removing a namespace that still has links |
| 410 | transfer_expired | |
| 409 | transfer_owner_changed | |
| 409 | transfer_creator_lost_access | |
| 409 | transfer_already_owner | |
| 404 | transfer_invalid | Unknown, used, revoked, or cross-organization token |
| 415 | unsupported_media_type | Body is not JSON |
| 413 | payload_too_large | Body exceeds the 64 KB limit |
| 429 | rate_limited | Spec 09 §6 |
| 500 | internal_error | Includes the request id in `details` |

## 5. Rate limits

Per session: 600 requests per minute on the API, 60 link creations per minute. The resolver is limited per IP at 1200 requests per minute. Limits are configurable (spec 09). Responses include `Retry-After`.
