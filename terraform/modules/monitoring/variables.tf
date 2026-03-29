###############################################################################
# Monitoring Module - Variables
###############################################################################

variable "alert_email" {
  description = "Email address for alert notifications"
  type        = string
}

variable "collector_function_name" {
  description = "Name of the collector Lambda function"
  type        = string
}

variable "scorer_function_name" {
  description = "Name of the scorer Lambda function"
  type        = string
}

variable "deliverer_function_name" {
  description = "Name of the deliverer Lambda function"
  type        = string
}

variable "dlq_arns" {
  description = "List of Dead Letter Queue ARNs for monitoring"
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
