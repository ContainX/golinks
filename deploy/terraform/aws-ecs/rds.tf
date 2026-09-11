resource "aws_db_subnet_group" "this" {
  name       = "${var.name}-db"
  subnet_ids = var.private_subnet_ids
}

# The master password is generated here rather than handed to RDS, because the service needs
# a whole DATABASE_URL and an ECS secret can only inject one JSON key. Secrets Manager holds
# the composed URL; see secrets.tf. RDS rejects /, @, ", and the space in a master password.
resource "random_password" "database" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# The first migration runs CREATE EXTENSION IF NOT EXISTS for pg_trgm, which backs keyword
# search, and citext, which types the email column. Both have been trusted extensions since
# PostgreSQL 13, so the golinks master user creates them with no extra grant and no custom
# parameter group.
resource "aws_db_instance" "this" {
  identifier     = "${var.name}-db"
  engine         = "postgres"
  engine_version = var.db_engine_version
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "golinks"
  username = "golinks"
  password = random_password.database.result

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = var.db_multi_az

  backup_retention_period = var.db_backup_retention_days
  copy_tags_to_snapshot   = true

  deletion_protection       = var.db_deletion_protection
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_skip_final_snapshot ? null : "${var.name}-db-final"

  auto_minor_version_upgrade = true

  # Changes wait for the next maintenance window, so a terraform apply during the day never
  # restarts the database under the running service.
  apply_immediately = false
}
