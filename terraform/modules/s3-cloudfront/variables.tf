variable "bucket_name" {
  description = "Name of the S3 bucket for detail pages"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}

variable "enable_auth" {
  description = "If true, attach the Lambda@Edge auth function to viewer-request"
  type        = bool
  default     = false
}

variable "auth_edge_lambda_arn" {
  description = "Qualified (versioned) ARN of the Lambda@Edge auth function. Required when enable_auth=true."
  type        = string
  default     = ""
}
