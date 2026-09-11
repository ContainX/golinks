resource "aws_ecs_cluster" "this" {
  name = var.name

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

# Logs are structured JSON on stdout, one line per request, with a request id that also comes
# back on the response, so a CloudWatch Logs Insights filter on requestId finds the whole story
# of one request.
resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${var.name}"
  retention_in_days = var.log_retention_days
}

# --- Roles ------------------------------------------------------------------

data "aws_iam_policy_document" "task_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# The execution role belongs to the ECS agent, not to the container: it pulls the image,
# writes the log streams, and reads the secret to build the task's environment.
resource "aws_iam_role" "execution" {
  name               = "${var.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn]
  }
}

resource "aws_iam_role_policy" "execution_secret" {
  name   = "read-app-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secret.json
}

# The task role belongs to the container. The service calls no AWS API, so the role exists
# only because Fargate requires one and carries nothing.
resource "aws_iam_role" "task" {
  name               = "${var.name}-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.task_assume.json
}

# The one exception: an interactive session is opened through SSM's messaging channels, and
# those calls are made with the task role.
data "aws_iam_policy_document" "task_exec_command" {
  count = var.enable_execute_command ? 1 : 0

  statement {
    actions = [
      "ssmmessages:CreateControlChannel",
      "ssmmessages:CreateDataChannel",
      "ssmmessages:OpenControlChannel",
      "ssmmessages:OpenDataChannel",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "task_exec_command" {
  count = var.enable_execute_command ? 1 : 0

  name   = "execute-command"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task_exec_command[0].json
}

# --- Task definitions -------------------------------------------------------

locals {
  # AUTH_TEST_MODE is deliberately absent. It accepts a signed token for any address in place
  # of the identity provider, and the service refuses to start with it on in production.
  environment = merge(
    {
      NODE_ENV             = "production"
      PORT                 = "3000"
      HOST                 = "0.0.0.0"
      BASE_URL             = var.base_url
      SHORT_HOST           = var.short_host
      LOG_LEVEL            = var.log_level
      OIDC_ISSUER          = var.oidc_issuer
      OIDC_CLIENT_ID       = var.oidc_client_id
      OIDC_SCOPES          = var.oidc_scopes
      OIDC_LABEL           = var.oidc_label
      OIDC_ADMIN_GROUPS    = join(",", var.oidc_admin_groups)
      OIDC_LOGOUT_AT_IDP   = tostring(var.oidc_logout_at_idp)
      ORG_RESOLUTION       = var.org_resolution
      ORG_ALLOWED_IDS      = join(",", var.org_allowed_ids)
      INITIAL_ADMIN_EMAILS = join(",", var.initial_admin_emails)
      EXTENSION_ORIGINS    = join(",", var.extension_origins)
      METRICS_ENABLED      = tostring(var.metrics_enabled)
      MIGRATE_ON_START     = tostring(var.migrate_on_start)

      # The load balancer terminates TLS, so the service has to read the forwarded protocol,
      # host, and client address rather than what it sees on the socket. Cookie security and
      # the per-address resolver rate limit both depend on it.
      TRUST_PROXY = "true"
    },
    var.org_fixed_id == null ? {} : { ORG_FIXED_ID = var.org_fixed_id },
    var.settings_overrides == null ? {} : { SETTINGS_OVERRIDES_JSON = jsonencode(var.settings_overrides) },
  )

  # Iterating a map gives a stable order, so an unchanged configuration never produces a new
  # task revision.
  container_environment = [for key, value in local.environment : { name = key, value = value }]

  container_secrets = [
    for key in local.secret_keys : {
      name = key
      # The trailing fields are the version id and version stage, both left to the default,
      # which is how ECS is told to pull one key out of the secret's JSON.
      valueFrom = "${aws_secretsmanager_secret.app.arn}:${key}::"
    }
  ]

  log_configuration = {
    logDriver = "awslogs"
    options = {
      "awslogs-group"         = aws_cloudwatch_log_group.app.name
      "awslogs-region"        = data.aws_region.current.region
      "awslogs-stream-prefix" = "app"
    }
  }

  runtime_platform = {
    # The published image is built for linux/amd64 only.
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = local.runtime_platform.cpu_architecture
    operating_system_family = local.runtime_platform.operating_system_family
  }

  container_definitions = jsonencode([
    {
      name         = var.name
      image        = var.image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment  = local.container_environment
      secrets      = local.container_secrets
      # No healthCheck here. The image already carries one, and what decides whether a task
      # takes traffic is the target group probing /_/health/ready.
      logConfiguration = local.log_configuration
    }
  ])

  lifecycle {
    precondition {
      condition     = var.org_resolution != "fixed" || var.org_fixed_id != null
      error_message = "org_resolution = \"fixed\" needs org_fixed_id, the one organization everybody joins."
    }

    precondition {
      condition     = var.desired_count <= 1 || var.redis_enabled
      error_message = "desired_count above 1 needs redis_enabled: sessions and caches have to be shared between tasks."
    }
  }
}

# The same image with a different command, run as a one-off task. It is how migrations are
# applied before a release that contains them, and the same definition serves the settings
# import and export commands with a command override at run time.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${var.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    cpu_architecture        = local.runtime_platform.cpu_architecture
    operating_system_family = local.runtime_platform.operating_system_family
  }

  container_definitions = jsonencode([
    {
      name        = "${var.name}-migrate"
      image       = var.image
      essential   = true
      command     = ["node", "apps/api/dist/cli.js", "migrate"]
      environment = local.container_environment
      secrets     = local.container_secrets
      logConfiguration = merge(local.log_configuration, {
        options = merge(local.log_configuration.options, { "awslogs-stream-prefix" = "migrate" })
      })
    }
  ])
}

# --- Service ----------------------------------------------------------------

resource "aws_ecs_service" "this" {
  name             = var.name
  cluster          = aws_ecs_cluster.this.id
  task_definition  = aws_ecs_task_definition.app.arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = var.name
    container_port   = 3000
  }

  # A task that will not become healthy, usually a configuration the service refuses to start
  # with, rolls the deployment back instead of leaving it stuck.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # Never drop below the running count during a rollout: new tasks come up, pass the health
  # check, and only then do the old ones go away.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  # Long enough for the process to validate its configuration, open the pool, and answer the
  # readiness probe.
  health_check_grace_period_seconds = 60

  enable_execute_command = var.enable_execute_command
  propagate_tags         = "SERVICE"

  depends_on = [
    aws_lb_listener.https,
    aws_lb_listener.http,
    aws_secretsmanager_secret_version.app,
  ]
}
