################################################################################
# Table Names
################################################################################
output "papers_table_name" {
  description = "Name of the papers DynamoDB table"
  value       = aws_dynamodb_table.papers.name
}

output "summaries_table_name" {
  description = "Name of the summaries DynamoDB table"
  value       = aws_dynamodb_table.summaries.name
}

output "delivery_log_table_name" {
  description = "Name of the delivery_log DynamoDB table"
  value       = aws_dynamodb_table.delivery_log.name
}

output "paper_sources_table_name" {
  description = "Name of the paper_sources DynamoDB table"
  value       = aws_dynamodb_table.paper_sources.name
}

output "feedback_table_name" {
  description = "Name of the feedback DynamoDB table"
  value       = aws_dynamodb_table.feedback.name
}

output "config_table_name" {
  description = "Name of the config DynamoDB table"
  value       = aws_dynamodb_table.config.name
}

output "pipeline_runs_table_name" {
  description = "Name of the pipeline_runs DynamoDB table"
  value       = aws_dynamodb_table.pipeline_runs.name
}

################################################################################
# Table ARNs
################################################################################
output "papers_table_arn" {
  description = "ARN of the papers DynamoDB table"
  value       = aws_dynamodb_table.papers.arn
}

output "summaries_table_arn" {
  description = "ARN of the summaries DynamoDB table"
  value       = aws_dynamodb_table.summaries.arn
}

output "delivery_log_table_arn" {
  description = "ARN of the delivery_log DynamoDB table"
  value       = aws_dynamodb_table.delivery_log.arn
}

output "paper_sources_table_arn" {
  description = "ARN of the paper_sources DynamoDB table"
  value       = aws_dynamodb_table.paper_sources.arn
}

output "feedback_table_arn" {
  description = "ARN of the feedback DynamoDB table"
  value       = aws_dynamodb_table.feedback.arn
}

output "config_table_arn" {
  description = "ARN of the config DynamoDB table"
  value       = aws_dynamodb_table.config.arn
}

output "pipeline_runs_table_arn" {
  description = "ARN of the pipeline_runs DynamoDB table"
  value       = aws_dynamodb_table.pipeline_runs.arn
}
