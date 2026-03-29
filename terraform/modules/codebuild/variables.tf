variable "ecr_repository_url" {
  description = "ECR repository URL"
  type        = string
}

variable "ecr_repository_arn" {
  description = "ECR repository ARN"
  type        = string
}

variable "source_location" {
  description = "Source repository URL (GitHub HTTPS)"
  type        = string
}

variable "buildspec_path" {
  description = "Path to buildspec.yml in the source"
  type        = string
  default     = "src/summarizer/buildspec.yml"
}

variable "tags" {
  description = "Resource tags"
  type        = map(string)
  default     = {}
}
