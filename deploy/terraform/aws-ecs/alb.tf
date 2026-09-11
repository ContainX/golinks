resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  internal           = var.internal_alb
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.public_subnet_ids

  # Routing here turns entirely on the Host header: one host is the canonical origin and
  # everything else is the short host, which the service redirects. Preserve what the client
  # sent rather than letting the load balancer normalise it.
  preserve_host_header = true

  drop_invalid_header_fields = true
  idle_timeout               = 60
}

resource "aws_lb_target_group" "app" {
  name        = "${var.name}-app"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  # A task that is going away has no long-lived connections to drain: every request is a
  # redirect or a small API call.
  deregistration_delay = "30"

  health_check {
    path                = "/_/health/ready"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# Port 80 forwards to the service instead of redirecting, because that is the port a bare
# go/keyword arrives on. The service reads the Host header, sees a host that is not the
# canonical one, and sends the browser to base_url with the same path, which is what makes
# the short host work without a certificate of its own.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

# The one exception: plain HTTP to the canonical host is pushed to HTTPS at the edge, so the
# session cookie is never at risk of travelling in the clear.
resource "aws_lb_listener_rule" "canonical_to_https" {
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  action {
    type = "redirect"

    redirect {
      protocol    = "HTTPS"
      port        = "443"
      status_code = "HTTP_301"
    }
  }

  condition {
    host_header {
      values = [local.canonical_host]
    }
  }
}
