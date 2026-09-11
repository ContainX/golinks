# Four security groups, each admitting exactly one source. The internet reaches the load
# balancer, the load balancer reaches the tasks, and only the tasks reach Postgres and Redis.
# Nothing else in the VPC can open a connection to the data stores.

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb"
  description = "Load balancer for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-alb" }
}

resource "aws_security_group" "tasks" {
  name        = "${var.name}-tasks"
  description = "Fargate tasks for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-tasks" }
}

resource "aws_security_group" "database" {
  name        = "${var.name}-database"
  description = "PostgreSQL for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-database" }
}

resource "aws_security_group" "redis" {
  count = var.redis_enabled ? 1 : 0

  name        = "${var.name}-redis"
  description = "Redis for ${var.name}"
  vpc_id      = var.vpc_id
  tags        = { Name = "${var.name}-redis" }
}

# --- Load balancer ----------------------------------------------------------

# Port 80 is how the short host arrives, so it is open to the same callers as port 443.
# The short host carries no certificate and no cookies: the service reads the Host header
# and answers with a redirect to the canonical origin.
resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  for_each = toset(var.alb_ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = "Short host traffic"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each = toset(var.alb_ingress_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = "Canonical host traffic"
  cidr_ipv4         = each.value
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "alb_to_tasks" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

# --- Tasks ------------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "tasks_from_alb" {
  security_group_id            = aws_security_group.tasks.id
  description                  = "Requests from the load balancer"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

# Outbound is open because the task pulls its image from a public registry and calls the
# identity provider, Secrets Manager, and CloudWatch Logs. All of that leaves through the
# NAT gateway on the private subnets.
resource "aws_vpc_security_group_egress_rule" "tasks_out" {
  security_group_id = aws_security_group.tasks.id
  description       = "Registry, identity provider, and AWS endpoints"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

# --- Data stores ------------------------------------------------------------

resource "aws_vpc_security_group_ingress_rule" "database_from_tasks" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_tasks" {
  count = var.redis_enabled ? 1 : 0

  security_group_id            = aws_security_group.redis[0].id
  description                  = "Redis from the tasks"
  referenced_security_group_id = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
}
