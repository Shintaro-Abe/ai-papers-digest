output "api_endpoint" {
  description = "API Gateway endpoint URL"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  description = "API Gateway ID"
  value       = aws_apigatewayv2_api.this.id
}

output "slack_events_url" {
  description = "Full URL for Slack Events API (POST /slack/events)"
  value       = "${aws_apigatewayv2_api.this.api_endpoint}/slack/events"
}
