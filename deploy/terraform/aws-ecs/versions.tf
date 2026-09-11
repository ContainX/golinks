terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

# Tags are set once here rather than on each resource, so that they also land on the things
# Terraform does not create directly, such as the network interfaces ECS attaches to tasks.
provider "aws" {
  region = var.region

  default_tags {
    tags = var.tags
  }
}

data "aws_region" "current" {}
