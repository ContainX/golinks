# ---------------------------------------------------------------------------
# Naming, region, tags
# ---------------------------------------------------------------------------

variable "name" {
  description = "Prefix for every resource this module creates, and the name of the ECS cluster and service."
  type        = string
  default     = "golinks"

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,20}$", var.name))
    error_message = "The name must be 1 to 21 lowercase letters, digits, or hyphens: several AWS names with short length limits are built from it."
  }
}

variable "region" {
  description = "AWS region. Leave unset to take the region from the environment or the shared AWS config."
  type        = string
  default     = null
}

variable "tags" {
  description = "Tags applied to every resource through the provider's default_tags."
  type        = map(string)
  default     = {}
}

# ---------------------------------------------------------------------------
# Network the caller brings
# ---------------------------------------------------------------------------

variable "vpc_id" {
  description = "The VPC everything is created in."
  type        = string
}

variable "private_subnet_ids" {
  description = "Subnets for the tasks, the database, and Redis, in at least two availability zones. They need egress through a NAT gateway so tasks can pull the image and reach the identity provider."
  type        = list(string)

  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Give at least two private subnets, in different availability zones."
  }
}

variable "public_subnet_ids" {
  description = "Subnets for the load balancer, in at least two availability zones. With internal_alb = true these are usually private subnets instead."
  type        = list(string)

  validation {
    condition     = length(var.public_subnet_ids) >= 2
    error_message = "An Application Load Balancer needs subnets in at least two availability zones."
  }
}

variable "certificate_arn" {
  description = "ACM certificate for the canonical host, already validated, in this region."
  type        = string
}

variable "internal_alb" {
  description = "Put the load balancer on private addresses only, for a deployment reachable through a VPN."
  type        = bool
  default     = false
}

variable "alb_ingress_cidrs" {
  description = "Address ranges allowed to reach the load balancer on port 80 and port 443."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

# ---------------------------------------------------------------------------
# The service
# ---------------------------------------------------------------------------

variable "base_url" {
  description = "Canonical origin, for example https://links.example.com. It drives cookies, the OIDC redirect URI, and the redirect that sends every other host here."
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.base_url))
    error_message = "The base_url must be an https origin with no path and no trailing slash, for example https://links.example.com."
  }
}

variable "short_host" {
  description = "Hostname members type before the keyword, so that go/handbook works. It appears in the app and in the OpenSearch descriptor."
  type        = string
  default     = "go"
}

variable "log_level" {
  description = "fatal, error, warn, info, debug, trace, or silent."
  type        = string
  default     = "info"
}

variable "metrics_enabled" {
  description = "Serve Prometheus metrics at /_/metrics. The load balancer forwards that path like any other, so narrow alb_ingress_cidrs or scrape over a private listener when this is on."
  type        = bool
  default     = false
}

variable "migrate_on_start" {
  description = "Apply pending migrations when a task starts. Leave this off and run the migrate task instead, so that a rollout of several tasks does not migrate several times."
  type        = bool
  default     = false
}

variable "settings_overrides" {
  description = <<-EOT
    Deployment settings overrides: a partial organization settings document whose values win
    over whatever each organization has stored, so the service comes up already branded with
    nobody signing in to set it up. Passed to the task as SETTINGS_OVERRIDES_JSON. Example:

      settings_overrides = {
        branding = { title = "Acme Links", primaryColor = "#1f4b99" }
        admins   = ["ops@acme.example"]
      }

    Leave unset to let admins configure everything in the app.
  EOT
  type        = any
  default     = null
}

# ---------------------------------------------------------------------------
# Identity provider
# ---------------------------------------------------------------------------

variable "oidc_issuer" {
  description = "Issuer URL, for example https://acme.okta.com or https://acme.okta.com/oauth2/default."
  type        = string
}

variable "oidc_client_id" {
  description = "Client id of the OIDC application."
  type        = string
}

variable "oidc_client_secret" {
  description = "Client secret of the OIDC application. Stored in Secrets Manager and injected into the task."
  type        = string
  sensitive   = true
}

variable "oidc_scopes" {
  description = "Scopes requested at sign-in. Add groups when admins come from identity provider groups."
  type        = string
  default     = "openid email profile"
}

variable "oidc_label" {
  description = "Button text on the sign-in page."
  type        = string
  default     = "Sign in"
}

variable "oidc_admin_groups" {
  description = "Group names whose members receive the admin role. Needs a groups claim on the application."
  type        = list(string)
  default     = []
}

variable "oidc_logout_at_idp" {
  description = "Send members to the provider's end session endpoint on sign-out."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Organizations
# ---------------------------------------------------------------------------

variable "org_resolution" {
  description = "domain puts each email domain in its own organization. fixed puts everyone in org_fixed_id, which is what a single-company deployment wants."
  type        = string
  default     = "domain"

  validation {
    condition     = contains(["domain", "fixed"], var.org_resolution)
    error_message = "org_resolution must be domain or fixed."
  }
}

variable "org_fixed_id" {
  description = "The one organization everybody joins. Required when org_resolution is fixed, ignored otherwise."
  type        = string
  default     = null
}

variable "org_allowed_ids" {
  description = "Optional allowlist of organization ids. A sign-in that resolves anywhere else is rejected."
  type        = list(string)
  default     = []
}

variable "initial_admin_emails" {
  description = "Emails that receive the admin role at sign-in, so a fresh deployment has an admin without anyone touching the database."
  type        = list(string)
  default     = []
}

variable "extension_origins" {
  description = "Browser extension origins the Origin check accepts besides the canonical origin, each chrome-extension:// followed by the extension id."
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

variable "db_engine_version" {
  description = "PostgreSQL version. A major number on its own keeps the instance on the latest minor release of that line."
  type        = string
  default     = "16"
}

variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Starting gp3 volume size in gigabytes."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Ceiling for storage autoscaling in gigabytes. Set it equal to db_allocated_storage to turn autoscaling off."
  type        = number
  default     = 100
}

variable "db_backup_retention_days" {
  description = "Days of automated backups, which is also the window point-in-time recovery can reach back to."
  type        = number
  default     = 7
}

variable "db_multi_az" {
  description = "Run a standby in a second availability zone and fail over to it."
  type        = bool
  default     = false
}

variable "db_deletion_protection" {
  description = "Refuse to delete the database. Set it to false and apply before destroying the deployment."
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Delete the database without taking a last snapshot. Leave it false anywhere the data matters."
  type        = bool
  default     = false
}

# ---------------------------------------------------------------------------
# Redis
# ---------------------------------------------------------------------------

variable "redis_enabled" {
  description = "Create ElastiCache for sessions and caches. Required for more than one task."
  type        = bool
  default     = true
}

variable "redis_engine_version" {
  description = "Redis version."
  type        = string
  default     = "7.1"
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.t4g.micro"
}

variable "redis_num_cache_clusters" {
  description = "Nodes in the replication group. Two or more turns on automatic failover across availability zones."
  type        = number
  default     = 1
}

# ---------------------------------------------------------------------------
# Tasks and the service
# ---------------------------------------------------------------------------

variable "image" {
  description = "Container image. Pin a released tag such as ghcr.io/containx/golinks:v1.4.0 so that a rollout is a change to this value and a rollback is the previous one."
  type        = string
  default     = "ghcr.io/containx/golinks:latest"
}

variable "cpu" {
  description = "Fargate CPU units for one task. 256, 512, 1024, 2048, or 4096."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Fargate memory in megabytes for one task, from the combinations Fargate allows for the chosen cpu."
  type        = number
  default     = 1024
}

variable "desired_count" {
  description = "How many tasks serve traffic. Anything above one needs redis_enabled."
  type        = number
  default     = 1
}

variable "enable_execute_command" {
  description = "Allow aws ecs execute-command to open a shell in a running task. Off by default because it widens what a console session can reach."
  type        = bool
  default     = false
}

variable "container_insights" {
  description = "Collect per-task CPU and memory metrics in CloudWatch."
  type        = bool
  default     = false
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps the service log group."
  type        = number
  default     = 30
}

variable "secret_recovery_window_days" {
  description = "Days Secrets Manager holds the deleted secret before removing it. Zero deletes it at once, which is what a throwaway environment that gets rebuilt under the same name wants."
  type        = number
  default     = 7
}

# ---------------------------------------------------------------------------
# DNS
# ---------------------------------------------------------------------------

variable "canonical_zone_id" {
  description = "Route 53 zone holding the canonical host. Leave unset to point that name at the load balancer yourself."
  type        = string
  default     = null
}

variable "short_host_zone_id" {
  description = "Route 53 zone the short host record goes in, normally a private hosted zone attached to the VPC or the organization's internal domain. Leave unset when the short host is served somewhere else."
  type        = string
  default     = null
}

variable "short_host_record_name" {
  description = "Record name for the short host inside short_host_zone_id."
  type        = string
  default     = null
}

# ---------------------------------------------------------------------------
# Derived values
# ---------------------------------------------------------------------------

locals {
  # The host in base_url with any port removed. The load balancer rule that pushes the
  # canonical host to HTTPS matches on it, and every other host reaching port 80 is answered
  # by the service with a redirect here.
  canonical_host = split(":", regex("^https://([^/]+)", var.base_url)[0])[0]

  short_host_record = coalesce(var.short_host_record_name, var.short_host)
}
