# Redis is optional. One task runs without it: sessions and caches then live in Postgres.
# More than one task needs it, so that a member stays signed in whichever task answers and
# so every task sees the same organization settings cache. Turn redis_enabled off only
# together with desired_count = 1.

resource "aws_elasticache_subnet_group" "this" {
  count = var.redis_enabled ? 1 : 0

  name       = "${var.name}-redis"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  count = var.redis_enabled ? 1 : 0

  replication_group_id = "${var.name}-redis"
  description          = "Sessions and caches for ${var.name}"

  engine               = "redis"
  engine_version       = var.redis_engine_version
  node_type            = var.redis_node_type
  num_cache_clusters   = var.redis_num_cache_clusters
  port                 = 6379
  parameter_group_name = "default.redis7"

  subnet_group_name  = aws_elasticache_subnet_group.this[0].name
  security_group_ids = [aws_security_group.redis[0].id]

  # No auth token. The security group is the boundary: only the tasks can open a connection.
  # A token would have to be carried in REDIS_URL as a password, which is one more secret to
  # rotate for nothing extra inside a private subnet. Transit encryption still applies, so
  # the URL is rediss://.
  at_rest_encryption_enabled = "true"
  transit_encryption_enabled = true

  automatic_failover_enabled = var.redis_num_cache_clusters > 1
  multi_az_enabled           = var.redis_num_cache_clusters > 1

  apply_immediately = false
}
