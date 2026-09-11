output "alb_dns_name" {
  description = "Load balancer hostname. Point the canonical host and the short host at it."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "Hosted zone of the load balancer, for an alias record created outside this module."
  value       = aws_lb.this.zone_id
}

output "canonical_host" {
  description = "The host in base_url. The certificate has to cover it and the DNS record has to name it."
  value       = local.canonical_host
}

output "database_endpoint" {
  description = "Host and port of the PostgreSQL instance."
  value       = aws_db_instance.this.endpoint
}

output "redis_endpoint" {
  description = "Primary endpoint of the replication group, or null when Redis is turned off."
  value       = var.redis_enabled ? aws_elasticache_replication_group.this[0].primary_endpoint_address : null
}

output "cluster_name" {
  description = "ECS cluster name."
  value       = aws_ecs_cluster.this.name
}

output "service_name" {
  description = "ECS service name."
  value       = aws_ecs_service.this.name
}

output "task_security_group_id" {
  description = "Security group the tasks run in. Anything else the service has to reach admits this group."
  value       = aws_security_group.tasks.id
}

output "app_secret_arn" {
  description = "Secrets Manager secret holding the database URL, the session key, and the identity provider secret."
  value       = aws_secretsmanager_secret.app.arn
}

output "log_group_name" {
  description = "CloudWatch log group carrying both the service and the one-off tasks."
  value       = aws_cloudwatch_log_group.app.name
}

output "migrate_task_command" {
  description = "Applies pending database migrations as a one-off Fargate task. Run it once after the first apply, and again before any release that brings migrations."
  value = join(" ", [
    "aws ecs run-task",
    "--region ${data.aws_region.current.region}",
    "--cluster ${aws_ecs_cluster.this.name}",
    "--task-definition ${aws_ecs_task_definition.migrate.family}",
    "--launch-type FARGATE",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", var.private_subnet_ids)}],securityGroups=[${aws_security_group.tasks.id}],assignPublicIp=DISABLED}'",
  ])
}

output "oidc_redirect_uri" {
  description = "Sign-in redirect URI to register on the OIDC application. Its sign-out redirect URI is base_url followed by a slash."
  value       = "${var.base_url}/_/auth/callback/oidc"
}
