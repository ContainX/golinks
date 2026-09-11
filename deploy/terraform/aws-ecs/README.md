# GoLinks on AWS with ECS Fargate

GoLinks is a self-hosted short-link service. A member types a memorable keyword such as
`go/handbook` into the browser and is redirected to the full destination URL. Links belong to
an organization and are visible only to its members.

This Terraform module stands one deployment up on AWS. It is a single flat root module: clone
it, fill in a handful of values, and apply. An organization that builds with its own modules
instead can follow `../../REQUIREMENTS.md`, which states what every component must provide and
names the file here that provides it.

## What it creates

- An Application Load Balancer with an HTTPS listener on your certificate and an HTTP listener
  for the short host, plus the four security groups that connect everything.
- An ECS Fargate cluster, a service, and a task definition for the application, and a second
  task definition used for one-off commands such as migrations.
- An RDS instance running PostgreSQL, encrypted, private, with automated backups.
- An ElastiCache replication group running Redis, encrypted in transit and at rest. Optional.
- One Secrets Manager secret holding the database URL, the session signing key, and the
  identity provider client secret, which the ECS agent injects into the task.
- A CloudWatch log group for both the service and the one-off tasks.
- Optionally, Route 53 alias records for the canonical host and the short host.

## Two hostnames, one service

Two names reach the same load balancer.

The **canonical host**, the one in `base_url`, is where the application actually lives. It has
the certificate, it is where cookies belong, and it is what the identity provider redirects
back to. Plain HTTP to this host is pushed to HTTPS at the load balancer.

The **short host**, `go` by default, is what members type. It arrives on port 80 with no
certificate, and the load balancer forwards it to the service unchanged. The service reads the
`Host` header, sees a host that is not the canonical one, and answers with a redirect to the
canonical origin carrying the same path. That is the whole trick behind `go/handbook`, and it
is why port 80 forwards rather than redirects.

## Prerequisites

- **A VPC** with private subnets in at least two availability zones that have egress through a
  NAT gateway, and public subnets in at least two availability zones for the load balancer.
  This module does not create a VPC.
- **An ACM certificate** for the canonical host, already validated, in the same region.
- **An OIDC application** at Okta or any other provider, using the authorization code grant.
  Its sign-in redirect URI is the `oidc_redirect_uri` output of this module, which is
  `<base_url>/_/auth/callback/oidc`, and its sign-out redirect URI is `<base_url>/`. You need
  its issuer URL, client id, and client secret. The redirect URI is only known after the first
  apply, but you can write it out by hand ahead of time: it is the base URL with that path.
- **AWS credentials** with permission to create the resources listed above, and somewhere to
  keep Terraform state.
- **Terraform 1.6 or newer.**

## Standing it up

1. Copy the example variables and fill them in.

   ```bash
   cp terraform.tfvars.example terraform.tfvars
   ```

   The values with no default are `vpc_id`, `private_subnet_ids`, `public_subnet_ids`,
   `certificate_arn`, `base_url`, `oidc_issuer`, `oidc_client_id`, and `oidc_client_secret`.
   Keep the client secret out of version control: put it in a file you do not commit, or pass
   it as `TF_VAR_oidc_client_secret`.

2. Initialize and apply.

   ```bash
   terraform init
   terraform apply
   ```

   The service starts, but its database has no tables yet, so the tasks will not become
   healthy until the next step.

3. Apply the database migrations once. The `migrate_task_command` output is the exact command,
   already carrying your cluster, subnets, and security group.

   ```bash
   terraform output -raw migrate_task_command
   ```

   Run what it prints. The task exits when it is done, and its output lands in the log group
   under the `migrate` prefix. Within a minute or two the service passes its health check.

4. Point DNS at the load balancer, both names.

   - The canonical host, an alias A record to `alb_dns_name` / `alb_zone_id`. Set
     `canonical_zone_id` and this module creates it.
   - The short host. A bare single-label name such as `go` only resolves on machines whose DNS
     search domain includes the zone the record lives in, so this usually belongs in a private
     hosted zone attached to the VPC or in the internal domain your office and VPN resolvers
     serve. Set `short_host_zone_id` to have this module create it, or create the same record
     wherever your client machines actually look. If neither is practical, members can still
     add the service as a browser search keyword: it publishes an OpenSearch descriptor at
     `/_/opensearch.xml`.

5. Sign in as one of the addresses in `initial_admin_emails`. Those addresses receive the admin
   role the first time they sign in, so the deployment has an administrator without anyone
   touching the database.

## Day two

**Rolling out a new image.** Change `image` to the new tag and apply. Terraform registers a new
task revision and ECS replaces the tasks one wave at a time, never dropping below the running
count. A task that will not become healthy trips the deployment circuit breaker and the service
rolls itself back to the previous revision. Rolling back on purpose is the same move with the
previous tag.

**A release that brings migrations.** Apply first with the new `image`, which updates both task
definitions, then run the migrate command from the output, then apply again if you had held the
service back. Simpler in practice: run the migrate task with the new image before or during the
rollout. Migrations are additive and are applied only once, so running the task when there is
nothing pending is harmless. `migrate_on_start` exists as an alternative but is off by default,
because with several tasks each one would try to migrate as it starts.

**Changing branding or other fixed settings.** `settings_overrides` is a partial organization
settings document whose values win over whatever each organization has stored, which is how a
fresh deployment comes up already branded. Change it and apply: Terraform writes a new task
revision and ECS rolls the service. The fields it accepts are branding, the banner, navigation
links, the admin list, the edit mode, the read-only switch, and the keyword pattern. Fields
fixed this way show as read-only in the admin screen, and a write that tries to change one is
rejected with the field named.

**Scaling.** Raise `desired_count` and apply. More than one task needs `redis_enabled`, because
sessions and caches have to be shared; the module refuses to plan the combination that would
sign members out at random. For an ElastiCache group that survives losing a node, set
`redis_num_cache_clusters` to 2 or more, which also turns on automatic failover across
availability zones. For a database that survives losing an availability zone, set `db_multi_az`.

**Importing a settings document.** The migrate task definition is the application image with a
different command, so any command line the service ships runs on it with an override. To apply
a settings document that includes fields `settings_overrides` does not accept, such as the
namespace list or the default namespace:

```bash
aws ecs run-task \
  --cluster "$(terraform output -raw cluster_name)" \
  --task-definition golinks-migrate \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-aaa,subnet-bbb],securityGroups=[$(terraform output -raw task_security_group_id)],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"golinks-migrate","command":["node","apps/api/dist/cli.js","settings","import","acme.example","/app/config/settings.json"]}]}'
```

The document has to be readable inside the container, so bake it into a downstream image with
`COPY config/ /app/config/`. The matching `settings export acme.example` command prints the
effective document to the task's log stream, which is how you get a starting point to edit.

**Logs.** Everything is in the CloudWatch log group named by the `log_group_name` output.
Service tasks write under the `app` prefix and one-off tasks under `migrate`. The lines are
structured JSON, each request carrying a request id that also comes back on the response, so
filtering on one request id in Logs Insights gives you the whole story of that request.
Liveness is at `/_/health/live` and readiness at `/_/health/ready`, which is what the target
group probes. Setting `metrics_enabled` serves Prometheus metrics at `/_/metrics`; the load
balancer forwards that path like any other, so narrow `alb_ingress_cidrs` when you turn it on.

**Backups and restores.** RDS takes automated backups and keeps them for
`db_backup_retention_days`, which is also how far back point-in-time recovery reaches. A
restore creates a new instance, so the way back from a bad afternoon is to restore to a
timestamp, note the new endpoint, and update the `DATABASE_URL` value in the Secrets Manager
secret the `app_secret_arn` output names, then force a new deployment so the tasks pick it up.
Redis holds only sessions and caches and is not backed up: losing it signs everybody out and
costs nothing else.

**Destroying.** `db_deletion_protection` defaults to true, so set it to false and apply before
running `terraform destroy`. Unless you also set `db_skip_final_snapshot`, RDS takes a last
snapshot named `<name>-db-final`, which then has to be deleted or renamed before a deployment
of the same name can be destroyed again. The Secrets Manager secret is held for
`secret_recovery_window_days` before it disappears, and the name cannot be reused until then;
set that variable to 0 for an environment you expect to rebuild under the same name.

## Egress

The tasks run in private subnets with no public address, so everything they reach goes out
through your NAT gateway: the container registry at `ghcr.io` to pull the image, your OIDC
issuer for sign-in and for the metadata and key documents it publishes, and the AWS endpoints
for Secrets Manager and CloudWatch Logs. A network that filters egress by destination needs all
of those allowed, or the tasks will not start.

## Notes

- **The database password** is generated by Terraform rather than managed by RDS, because the
  service wants a whole `DATABASE_URL` and an ECS secret can only inject one JSON key. The
  composed URL lives in Secrets Manager. It means the password is in Terraform state, so keep
  state in an encrypted backend.
- **The connection requires TLS.** RDS for PostgreSQL 15 and newer refuses plaintext
  connections, and the composed URL says `sslmode=require`.
- **The extensions install themselves.** The first migration creates `pg_trgm`, which backs
  keyword search, and `citext`, which types the email column. Both are trusted extensions, so
  the master user creates them with no extra grant and no custom parameter group.
- **Test sign-in is never enabled.** The variable that turns it on is deliberately absent from
  the task definition, and the service refuses to start with it on in production.
