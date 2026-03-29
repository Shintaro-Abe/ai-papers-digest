variable "table_name_prefix" {
  description = "Prefix for DynamoDB table names"
  type        = string
  default     = "ai-papers-digest"
}

variable "tags" {
  description = "Tags to apply to all DynamoDB resources"
  type        = map(string)
  default     = {}
}
