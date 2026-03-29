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

variable "tags" {
  description = "Common tags for all resources"
  type        = map(string)
  default = {
    Project     = "ai-papers-digest"
    Environment = "prod"
    ManagedBy   = "terraform"
  }
}
