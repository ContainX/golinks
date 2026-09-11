# The canonical host, the one in base_url. Everything the browser keeps, cookies and the
# OIDC redirect, belongs to this name.
resource "aws_route53_record" "canonical" {
  count = var.canonical_zone_id == null ? 0 : 1

  zone_id = var.canonical_zone_id
  name    = local.canonical_host
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}

# The short host, so that typing go/handbook reaches the service on port 80.
#
# A bare single-label name like go resolves only on machines whose DNS search domain includes
# this zone, which is what a private hosted zone attached to the VPC gives tasks, and what the
# office or VPN domain gives members. An organization that does not run its client DNS in
# Route 53 leaves this unset and creates the same record in whatever does serve its clients.
# Either way the service only needs the name to land on the load balancer on port 80.
resource "aws_route53_record" "short_host" {
  count = var.short_host_zone_id == null ? 0 : 1

  zone_id = var.short_host_zone_id
  name    = local.short_host_record
  type    = "A"

  alias {
    name                   = aws_lb.this.dns_name
    zone_id                = aws_lb.this.zone_id
    evaluate_target_health = true
  }
}
