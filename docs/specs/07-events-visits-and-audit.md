# 07. Events, Visits, and Audit

## 1. Audit events

Table `audit_events`, append-only:

| Column | Notes |
|---|---|
| id | bigint identity |
| organization_id | text |
| type | See §1.1 |
| actor_user_id | Member who caused it; null for system actions |
| object_type | `link`, `user`, `organization`, `transfer` |
| object_id | text |
| data | jsonb: snapshot or diff as described per type |
| request_id | For correlation with logs |
| created_at | timestamptz |

Indexes: `(organization_id, created_at desc)`, `(organization_id, object_type, object_id)`.

### 1.1 Event types

| Type | Data |
|---|---|
| user.created | `{ email, organizationId, role }` |
| user.updated | `{ changes: { isEnabled?: [old, new], role?: [old, new] } }` |
| link.created | Link snapshot |
| link.updated | `{ changes: { destination?: [old, new], keyword?: [...], namespace?: [...], isUnlisted?: [...] } }` |
| link.deleted | Link snapshot |
| link.transferred | `{ fromUserId, toUserId, method: "direct" \| "transferLink" }` |
| transfer.created | `{ linkId, expiresAt }` |
| organization.settings_updated | `{ changes: { <field>: [old, new] } }` |

Visits are not audit events; they have their own table (§2).

### 1.2 Access

Admins read events through `GET /_/api/v1/admin/events`. Members do not see events in v1.

### 1.3 Retention

Audit events are kept indefinitely in v1.

## 2. Visits

### 2.1 Counters

`links.visit_count` and `links.last_visited_at` are updated on every hit with a single `UPDATE ... SET visit_count = visit_count + 1`. This is the value the directory sorts by.

### 2.2 Visit records

Table `link_visits`:

| Column | Notes |
|---|---|
| id | bigint identity |
| link_id | FK links, cascade on delete |
| organization_id | text, denormalized for retention and reporting |
| user_id | FK users |
| via | `browser`, `search`, `ext`, `api` |
| visited_at | timestamptz |

Index: `(organization_id, visited_at)`, `(link_id, visited_at)`.

Both writes happen off the resolver's critical path (spec 04 §6). In v1 they are issued immediately after the response is sent. If measurements show write pressure, a Redis buffer flushed every few seconds is the planned upgrade; the resolver interface does not change.

### 2.3 Retention

A scheduled job deletes `link_visits` rows older than `VISIT_RETENTION_DAYS` (default 365) in batches. Counters are unaffected.

## 3. Metrics

The service exposes Prometheus metrics at `/_/metrics` when `METRICS_ENABLED=true`: resolver hits and misses by organization, resolver latency histogram, API request counts and latency by route and status, session store latency, and background job outcomes. Access is unauthenticated but the endpoint SHOULD be restricted at the network layer.

## 4. Webhooks

Not in v1. The audit event table is designed so that a later delivery worker can subscribe to it: per-organization endpoints, HMAC-signed payloads, retries with backoff, and a delivery log. Nothing in v1 should preclude this.
