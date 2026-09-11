# 00. Overview

## What GoLinks is

GoLinks is a self-hosted short-link service for organizations. A member types a short, memorable keyword such as `go/handbook` into the browser address bar and is redirected to the full destination URL. Links belong to an organization and are visible only to its members.

## Goals

1. Fast, dependable redirects. The resolve-and-redirect path is the product.
2. Strict organization isolation. A link is never visible to, or resolvable by, another organization.
3. Frictionless creation. Typing an unknown keyword lands the member on a pre-filled creation form with similar existing links suggested.
4. Programmatic links with placeholders, for example `go/gh/%s` pointing at `https://github.com/acme/%s`.
5. A searchable directory of the organization's links.
6. Enterprise sign-in through Okta using OpenID Connect, with any compliant OIDC provider supported.
7. Simple operations: one container image, Postgres, and optional Redis.

## Non-goals for v1

- A browser extension. Members reach `go/...` through DNS for the short host and through the OpenSearch descriptor (see spec 11). An extension may come later.
- Public or anonymous links. Every redirect requires a signed-in member.
- Analytics dashboards beyond per-link visit counts.
- Multi-region deployment.

## Glossary

| Term | Meaning |
|---|---|
| Organization | The tenant that owns links. Derived from the member's email domain, or fixed per deployment. |
| Member | A signed-in user who belongs to exactly one organization. |
| Admin | A member with the admin role. Manages all links, users, and settings of their organization. |
| Namespace | The first path segment that groups keywords. `go` by default; an organization may add more, such as `eng` or `docs`. |
| Default namespace | The namespace assumed when a request path does not begin with a configured namespace. |
| Keyword | The path after the namespace: `handbook`, `jira/%s`, `meeting-notes/2026-09`. |
| Segment | One `/`-separated part of a keyword. |
| Destination | The absolute URL a keyword redirects to. |
| Programmatic link | A link whose keyword contains `%s` placeholder segments. Their values are substituted into the destination. |
| Hierarchical keyword | A keyword with more than one segment and no placeholders. |
| Unlisted link | A link anyone in the organization can use if they know it, but that the directory shows only to its owner and admins. |
| Owner | The member responsible for a link. |
| Resolution | Turning a requested path into a destination URL. |
| Short host | The bare hostname members type, normally `go`. It forwards to the canonical host. |
| Canonical host | The full hostname the service is deployed on, for example `links.example.com`. |

## Architecture at a glance

One web service exposes three surfaces:

- The redirect resolver, which owns every path that does not start with `/_/`.
- The HTTP API under `/_/api/v1`.
- The web application, served at `/` and under `/_/`.

Postgres stores everything. Redis is optional and, when present, holds sessions and caches. Sign-in is OpenID Connect.

```mermaid
flowchart LR
  Browser -->|go/handbook| ShortHost[Short host go]
  ShortHost -->|302 to canonical host| Service
  Browser -->|links.example.com/...| Service
  Service --> Resolver
  Service --> API[/_/api/v1]
  Service --> Web[Web app]
  Resolver --> PG[(Postgres)]
  API --> PG
  Service --> Redis[(Redis, optional)]
  Service <--> IdP[Okta / OIDC]
```

## Spec index

| # | Spec | Covers |
|---|---|---|
| 01 | Organizations and users | Tenant identity, user records, roles, disabled users |
| 02 | Authentication and sessions | OIDC sign-in, sessions, sign-out, CSRF, security headers, test sign-in |
| 03 | Links | Data model, keyword and destination rules, permissions, create/update/delete, transfers, search |
| 04 | Resolution and redirect | The algorithm behind `go/<path>`, namespaces, placeholders, misses, visit recording |
| 05 | HTTP API | Endpoint contract, shapes, error codes |
| 06 | Organization settings and configuration | Per-organization settings schema and deployment configuration |
| 07 | Events, visits, and audit | Audit events, visit records, retention, future webhooks |
| 08 | Web app features | Feature inventory for the UI. UX flows intentionally deferred. |
| 09 | Infrastructure and operations | Docker, migrations, logging, health, CI/CD |
| 10 | Testing strategy | Unit, integration, end-to-end |
| 11 | Browser and short-host integration | DNS for `go`, host bounce, OpenSearch, future clients |
| 12 | Browser extension | Chrome extension: short-host redirect without DNS, omnibox keyword, create-from-page popup, session-based auth; Safari deferred |

## Conventions in these specs

- MUST, SHOULD, and MAY carry their RFC 2119 meanings.
- Examples assume the default namespace `go`, the short host `go`, and the canonical host `links.example.com`.
- Identifiers are serialized as strings in JSON regardless of their storage type.
