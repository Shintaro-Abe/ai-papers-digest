################################################################################
# API Gateway Module - Slack Events API Endpoint
################################################################################

# ------------------------------------------------------------------------------
# HTTP API (v2)
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = "ai-papers-digest-api"
  protocol_type = "HTTP"
  description   = "AI Papers Digest - Slack Events API endpoint"

  tags = var.tags
}

# ------------------------------------------------------------------------------
# Stage (auto-deploy)
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  default_route_settings {
    throttling_burst_limit = 20
    throttling_rate_limit  = 10
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      ip             = "$context.identity.sourceIp"
      requestTime    = "$context.requestTime"
      httpMethod     = "$context.httpMethod"
      routeKey       = "$context.routeKey"
      status         = "$context.status"
      protocol       = "$context.protocol"
      responseLength = "$context.responseLength"
      errorMessage   = "$context.error.message"
    })
  }

  tags = var.tags
}

# ------------------------------------------------------------------------------
# Lambda Integration
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_integration" "feedback" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = var.feedback_lambda_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

# ------------------------------------------------------------------------------
# Route: POST /slack/events
# ------------------------------------------------------------------------------

resource "aws_apigatewayv2_route" "slack_events" {
  api_id    = aws_apigatewayv2_api.this.id
  route_key = "POST /slack/events"
  target    = "integrations/${aws_apigatewayv2_integration.feedback.id}"
}

# ------------------------------------------------------------------------------
# Lambda Permission
# ------------------------------------------------------------------------------

resource "aws_lambda_permission" "api_gateway" {
  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.feedback_lambda_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}

# ------------------------------------------------------------------------------
# CloudWatch Log Group (access logs)
# ------------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/ai-papers-digest-api"
  retention_in_days = 30
  tags              = var.tags
}
