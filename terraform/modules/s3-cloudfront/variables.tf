variable "bucket_name" {
  description = "Name of the S3 bucket for detail pages"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
