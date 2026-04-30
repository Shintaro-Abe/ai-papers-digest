variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "ap-northeast-1"
}

variable "alert_email" {
  description = "Email address for CloudWatch alarm notifications"
  type        = string
}

variable "pages_bucket_name" {
  description = "S3 bucket name for detail pages"
  type        = string
}

variable "github_repository_url" {
  description = "GitHub repository HTTPS URL for CodeBuild source"
  type        = string
}

variable "admin_email" {
  description = "Email address for the initial Cognito admin user (receives temporary password by email)"
  type        = string
}

variable "cloudfront_domain" {
  description = "CloudFront distribution domain (e.g., d2qwzdsbt0ubup.cloudfront.net). Hardcoded to avoid a circular dependency between cognito callback_urls and the cloudfront distribution. Get from `terraform output` after the first apply."
  type        = string
  default     = "d2qwzdsbt0ubup.cloudfront.net"
}

variable "enable_auth" {
  description = "If true, attach the Lambda@Edge auth function to CloudFront viewer-request. Set to false for instant rollback (~few minutes)."
  type        = bool
  default     = false
}

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project     = "ai-papers-digest"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}
