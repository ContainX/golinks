# 01. Organizations and Users

## 1. Organizations

### 1.1 Identity

An organization is identified by a lowercase string id such as `acme.com`. Organizations are created implicitly the first time one of their members signs in. There is no organization sign-up flow.

### 1.2 Resolving the organization for a sign-in

The deployment chooses a strategy with `ORG_RESOLUTION`:

- `domain` (default). The organization id is the domain part of the verified email address, lowercased. Addresses at consumer email providers (gmail.com, outlook.com, icloud.com, and so on) map to the full email address instead, so each personal account is its own single-member organization. The consumer provider list lives in code as a constant and MUST be easy to extend.
- `fixed`. Every member belongs to the organization named by `ORG_FIXED_ID`. This is the recommended mode for a single-company Okta deployment, where contractors and subsidiaries may sign in with other email domains but should share one link space.

After the strategy runs, `ORG_DOMAIN_ALIASES` (a map such as `acme.co.uk=acme.com,jane@gmail.com=acme.com`) is applied. Aliases let a second domain, or a specific personal address, join an existing organization.

`ORG_ALLOWED_IDS` is an optional allowlist. If set, a sign-in whose resolved organization is not in the list is rejected with the error code `org_not_allowed`. It is a second gate behind the identity provider's own assignment rules.

### 1.3 Storage

Table `organizations`:

| Column | Type | Notes |
|---|---|---|
| id | text, primary key | Lowercase |
| settings | jsonb | See spec 06. Validated against the settings schema on every write. |
| created_at | timestamptz | |
| updated_at | timestamptz | |

A row is inserted with default settings on the first sign-in of a member of that organization.

## 2. Users

### 2.1 Storage

Table `users`:

| Column | Type | Notes |
|---|---|---|
| id | bigint identity, primary key | |
| email | citext, unique | Lowercased and trimmed. Globally unique: an email belongs to exactly one organization. |
| organization_id | text, FK organizations | |
| role | text | `member` or `admin` |
| role_source | text | `config`, `idp`, or `manual`. See 2.3. |
| is_enabled | boolean, default true | |
| preferences | jsonb | See 2.5 |
| last_login_at | timestamptz | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### 2.2 Creation

A user is created on their first successful sign-in (spec 02). Creation emits a `user.created` audit event (spec 07). There is no admin "invite" flow in v1; access is governed by the identity provider.

### 2.3 Roles and admin determination

Roles are `member` and `admin`. Admins are scoped to their own organization only.

The effective role is recomputed on every sign-in unless it was set manually:

1. If `role_source` is `manual`, keep the stored role. Manual changes are made by another admin through the admin API.
2. Otherwise the user is `admin` when either is true, and `member` otherwise:
   - the email is listed in the organization's `admins` setting (spec 06) or in the deployment's `INITIAL_ADMIN_EMAILS`;
   - the identity provider's claims include a group named in `OIDC_ADMIN_GROUPS` (Okta groups claim, see spec 02).
   The stored `role_source` becomes `config` or `idp` accordingly.

Bootstrapping: `INITIAL_ADMIN_EMAILS` exists so that a fresh deployment has at least one admin without editing the database.

Admins can:

- create, edit, delete, and transfer any link in their organization, and create links on behalf of another member;
- list and view users in their organization, enable or disable them, and change their role;
- view and edit organization settings.

An admin MUST NOT be able to disable or demote themselves; the API returns `cannot_modify_self`.

### 2.4 Disabled users

When `is_enabled` is false:

- sign-in is rejected with `account_disabled`;
- any existing session is destroyed on its next request, and the browser is sent to the sign-in page with `error=account_disabled`;
- the user's links remain owned by them and keep resolving. Admins can transfer them.

Users are never deleted in v1. Disabling is the deprovisioning action, so foreign keys from links to users never dangle.

### 2.5 Preferences

Free-form JSON owned by the user and editable only by them through `PATCH /_/api/v1/me`. Allowed keys are whitelisted in the shared schema. Initial keys:

- `dismissedNotices`: array of notice ids the user closed. No notice uses it today; the key is kept so a future one can.
- `colorScheme`: `system` (default), `light`, or `dark`.

Unknown keys are rejected with a validation error.

### 2.6 Visibility of user data

Members can see the email address of any link owner in their organization, since the directory shows owners. Only admins can list users.
