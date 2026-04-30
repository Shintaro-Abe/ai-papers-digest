################################################################################
# Lambda@Edge Module - Outputs
################################################################################

output "function_name" {
  description = "Name of the Lambda@Edge function"
  value       = aws_lambda_function.auth_edge.function_name
}

output "qualified_arn" {
  description = "Versioned ARN of the Lambda@Edge function (required by CloudFront)"
  value       = aws_lambda_function.auth_edge.qualified_arn
}

output "version" {
  description = "Published version number"
  value       = aws_lambda_function.auth_edge.version
}
