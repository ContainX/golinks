# Security

## Reporting a vulnerability

Do not open a public issue. Use the repository's private vulnerability reporting (the **Security** tab, then **Report a vulnerability**) so the report reaches the maintainers alone. Include the version, the steps to reproduce, and what an attacker gains.

You will get an acknowledgement, a fix or a mitigation, and credit in the release notes if you want it. Please allow time for a fix to ship before publishing details.

## Supported versions

The latest release receives fixes. Upgrading is a new image and a migration; a downgrade by one version is supported, so staying current is cheap.

## What the service protects, in short

- Sign-in is OpenID Connect only, with PKCE on top of the client secret; the test sign-in mode is refused in production.
- Sessions are server-side, in cookies that are `HttpOnly`, `Secure`, and scoped to the canonical host.
- State-changing requests are checked against the `Origin` header; only the canonical origin and the configured browser extension origins are accepted.
- The content security policy allows no third-party script, style, or font host and no inline scripts.
- Every request is rate limited; the resolver ignores request bodies, and the API caps them at 64 KB.
- Organizations are isolated at the query level and the integration tests prove it with two organizations.

`deploy/README.md` describes the platform's side: TLS at the load balancer, private data stores, secrets outside the image, and the one endpoint (`/_/metrics`) that must be protected at the edge when enabled.
