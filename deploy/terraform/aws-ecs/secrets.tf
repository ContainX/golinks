resource "random_password" "session_secret" {
  length = 64

  # Alphanumeric only. The value is a signing key, never parsed, and keeping it free of
  # punctuation means it can be copied around by hand without quoting surprises.
  special = false
}

locals {
  # sslmode=require is not optional: RDS for PostgreSQL 15 and newer refuses plaintext
  # connections, and the client reads sslmode straight from this URL. The credentials are
  # URL encoded because a generated password may contain characters that are structural in
  # a connection string.
  database_url = "postgres://${urlencode(aws_db_instance.this.username)}:${urlencode(random_password.database.result)}@${aws_db_instance.this.address}:${aws_db_instance.this.port}/${aws_db_instance.this.db_name}?sslmode=require"

  redis_url = var.redis_enabled ? "rediss://${aws_elasticache_replication_group.this[0].primary_endpoint_address}:6379" : null

  app_secret = merge(
    {
      DATABASE_URL       = local.database_url
      SESSION_SECRET     = random_password.session_secret.result
      OIDC_CLIENT_SECRET = var.oidc_client_secret
    },
    var.redis_enabled ? { REDIS_URL = local.redis_url } : {},
  )

  # Listed rather than read back from app_secret, so that building the task definition never
  # touches a sensitive value: ECS is given the key name and looks the value up itself.
  secret_keys = concat(
    ["DATABASE_URL", "SESSION_SECRET", "OIDC_CLIENT_SECRET"],
    var.redis_enabled ? ["REDIS_URL"] : [],
  )
}

# One secret holds everything the task must not have in its environment in the clear. The
# execution role may read this secret and nothing else.
resource "aws_secretsmanager_secret" "app" {
  name                    = "${var.name}/app"
  description             = "Database URL, session key, and identity provider secret for ${var.name}"
  recovery_window_in_days = var.secret_recovery_window_days
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.app_secret)
}
