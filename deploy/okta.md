# Setting up GoLinks in Okta

This page is for the Okta administrator. It walks through creating the app integration, explains each choice, and ends with the list of values to hand back to whoever deploys the service. The deployer's side, turning those values into configuration, is the last section.

The service signs members in with OpenID Connect using the authorization code flow, with PKCE on top of the client secret. It asks Okta for the member's email address and, if you want Okta groups to decide who is an admin, their group memberships. It stores nothing else from Okta.

## Before you start

Get three things from the deployer:

| Ask for | Example | Why |
|---|---|---|
| The service's canonical address (`BASE_URL`) | `https://links.example.com` | Both redirect URIs derive from it |
| The provider id they will configure (`OIDC_ID`) | `okta` | It is the last segment of the sign-in redirect URI. The default is `oidc`; `okta` reads better in Okta's own logs |
| Whether admins come from an Okta group | yes, `GoLinks Admins` | Decides whether you configure a groups claim |

Console paths below are as of 2026; Okta occasionally renames a label, but the setting is in the same place.

## 1. Create the app integration

1. In the Admin Console go to **Applications → Applications** and choose **Create App Integration**.
2. Sign-in method: **OIDC - OpenID Connect**. Application type: **Web Application**. Continue.
3. **General Settings**
   - App integration name: `GoLinks` (or whatever the organization calls it; members see this name in their Okta dashboard).
   - Logo: optional.
   - Grant type: **Authorization Code** is checked and is the only one the service uses. Leave **Refresh Token** unchecked; the service keeps its own session and never refreshes tokens. Leave the implicit and hybrid options unchecked.
   - **Sign-in redirect URIs**: exactly one entry, `<BASE_URL>/_/auth/callback/<OIDC_ID>`. With the example values above that is `https://links.example.com/_/auth/callback/okta`. No trailing slash, no wildcard.
   - **Sign-out redirect URIs**: `<BASE_URL>/`, for example `https://links.example.com/`. This is where Okta sends a member after signing them out of Okta, if the deployer turns that on.
   - Trusted Origins: none needed. The service talks to Okta from its server, never from the browser.
4. **Assignments** (labelled **Controlled access** on this screen): choose who may sign in. **Allow everyone in your organization to access** is the usual answer for an internal tool; **Limit access to selected groups** if only part of the company should use it. This can be changed later on the Assignments tab. A member who is not assigned sees an Okta error page saying the user is not assigned to the application.
5. Save.

## 2. Client credentials

On the application's **General** tab, under **Client Credentials**:

- **Client ID**: copy it for the deployer.
- **Client authentication**: **Client secret**. Copy the secret now; Okta shows it once. Hand it over through a secret-sharing channel, never in a ticket or chat message.
- **Proof Key for Code Exchange (PKCE)**: turn on **Require PKCE as additional verification**. The service always sends a PKCE challenge, so requiring it costs nothing and closes the door to a client that does not.

## 3. Choose the authorization server

The deployer's `OIDC_ISSUER` is one of two URLs:

- **The org authorization server**: `https://<your-org>.okta.com` (the org URL as members see it, not the `-admin` one). This is the simplest choice and works on every Okta plan. Groups claims for it are configured on the app itself (section 4, option A).
- **A custom authorization server**: `https://<your-org>.okta.com/oauth2/default` or another server you created under **Security → API**. Choose this if your organization's policy requires custom servers. Groups claims for it are configured on the server (section 4, option B), and its access policy must allow this client.

Tell the deployer which one you chose; they configure the issuer exactly as written here, with no trailing slash.

## 4. Admins from an Okta group (optional)

Skip this section if the deployer will name admins by email address instead. Otherwise:

1. Create the group under **Directory → Groups**, for example `GoLinks Admins`, and add the first admins to it.
2. Assign the group to the application on the app's **Assignments** tab (**Assign → Assign to Groups**), unless everyone in the organization is already assigned.
3. Make Okta send group names to the service. The service asks for the `groups` scope and reads a claim named `groups` from the userinfo response first and the ID token second, so either place works.

**Option A: org authorization server.** On the application's **Sign On** tab, in the **OpenID Connect ID Token** section, choose **Edit**:

- Groups claim type: **Filter**.
- Groups claim filter: claim name `groups`, then **Starts with** `GoLinks` (or **Matches regex** `.*` to send every group).
- Save.

**Option B: custom authorization server.** Under **Security → API → Authorization Servers**, open the server:

- **Scopes → Add Scope**: name `groups`. No user consent needed. This scope does not exist on a custom server until you add it, and without it the service's request is refused.
- **Claims → Add Claim**: name `groups`; include in token type **ID Token**, **Always**; value type **Groups**; filter **Starts with** `GoLinks` (or **Matches regex** `.*`); include in **the following scopes**: `groups`. Add the same claim for the **Access Token** type too, so the userinfo response carries it as well.
- **Access Policies**: confirm a policy covers this client (a policy assigned to **All clients** or to this application) with a rule allowing the **Authorization Code** grant and the requested scopes.

Prefer a **Starts with** filter over sending every group. The service only needs the admin group, and a member in hundreds of groups would otherwise get an oversized token.

The service compares the group's name, not its id, case-insensitively and whole. Hand the deployer the exact name.

## 5. What to hand back

| Item | Where you found it | Becomes |
|---|---|---|
| Issuer URL | section 3 | `OIDC_ISSUER` |
| Client ID | General tab, Client Credentials | `OIDC_CLIENT_ID` |
| Client secret | same, shown once, sent through a secret channel | `OIDC_CLIENT_SECRET` |
| The provider id you put in the redirect URI | section 1 | `OIDC_ID` |
| Admin group name(s), spelled exactly | section 4 | `OIDC_ADMIN_GROUPS` |
| Whether the groups claim is configured | section 4 | whether `groups` joins `OIDC_SCOPES` |
| Confirmation that the right people are assigned | Assignments tab | nothing to configure; sign-in fails without it |

## 6. What the deployer does with it

On the service, in its environment or secret store:

```bash
OIDC_ID=okta
OIDC_ISSUER=https://acme.okta.com
OIDC_CLIENT_ID=0oa...
OIDC_CLIENT_SECRET=...            # from the secret store
OIDC_SCOPES="openid email profile groups"   # drop "groups" when admins are named by email
OIDC_ADMIN_GROUPS="GoLinks Admins"
OIDC_LABEL="Sign in with Okta"
OIDC_LOGOUT_AT_IDP=false          # true to also end the Okta session on sign-out
```

`OIDC_ID` must match the last segment of the redirect URI registered in Okta. `INITIAL_ADMIN_EMAILS` can name the first admins by address instead of, or as well as, the group. In the reference Terraform these are the `oidc_*` inputs and the `oidc_redirect_uri` output is the value to give the Okta administrator.

## 7. Verify

1. Open the service's address. With one provider configured it goes straight to Okta.
2. Sign in as someone in the admin group. The account menu shows the role; **Admin** appears in the navigation.
3. Sign in as an ordinary member and confirm they can create a link but not open the admin pages.

If something fails, the **Reports → System Log** in Okta names the reason on the Okta side, and the service's log line for the request (with its request id) names it on the service side. The usual causes:

| Symptom | Cause |
|---|---|
| Okta page: the `redirect_uri` parameter must be a login redirect URI | The URI in Okta and `<BASE_URL>/_/auth/callback/<OIDC_ID>` differ, often by scheme, trailing slash, or provider id |
| Okta page: user is not assigned to the client application | Assignments (section 1 step 4) |
| Service sign-in page: your email address is not verified | Okta reports the address as unverified; verify it in the Okta profile |
| Member signs in but is not an admin | `groups` missing from `OIDC_SCOPES`, the claim filter does not match the group, the custom server lacks the `groups` scope, or the name in `OIDC_ADMIN_GROUPS` is spelled differently |
| Okta page: invalid scope | The custom authorization server has no `groups` scope (section 4, option B) |

## 8. Later changes

- **Rotating the client secret.** Okta allows a second secret on the same client: generate the new one, give it to the deployer, and deactivate the old one once the service is running with the new value. No downtime.
- **Changing the service's address.** Update both redirect URIs in Okta and `BASE_URL` on the service in the same change; sign-in is refused while they disagree.
- **Adding or removing admins.** Change the group membership in Okta. The role is recomputed at the member's next sign-in.
- **Ending the Okta session on sign-out.** The deployer sets `OIDC_LOGOUT_AT_IDP=true`; the sign-out redirect URI from section 1 is what makes it work.
