################################################################################
# ECS Module - Variables
################################################################################

variable "ecr_image_uri" {
  description = "Full ECR image URI for the summarizer container"
  type        = string
}

variable "papers_table_name" {
  description = "DynamoDB Papers table name"
  type        = string
}

variable "summaries_table_name" {
  description = "DynamoDB Summaries table name"
  type        = string
}

variable "detail_page_base_url" {
  description = "Base URL for the detail page"
  type        = string
}

variable "secrets_manager_arn" {
  description = "ARN of the Secrets Manager secret containing CLAUDE_ACCESS_TOKEN"
  type        = string
}

variable "dynamodb_table_arns" {
  description = "List of DynamoDB table ARNs for task role permissions"
  type        = list(string)
}

variable "s3_bucket_arn" {
  description = "ARN of the S3 bucket for task role PutObject permission"
  type        = string
}

variable "s3_bucket_name" {
  description = "S3 bucket name for PAGES_BUCKET env var"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
