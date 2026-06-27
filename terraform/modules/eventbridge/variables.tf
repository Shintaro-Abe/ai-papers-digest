###############################################################################
# EventBridge Module - Variables
###############################################################################

variable "collector_lambda_arn" {
  description = "ARN of the collector Lambda function"
  type        = string
}

variable "collector_lambda_name" {
  description = "Name of the collector Lambda function"
  type        = string
}

variable "deliverer_lambda_arn" {
  description = "ARN of the deliverer Lambda function"
  type        = string
}

variable "deliverer_lambda_name" {
  description = "Name of the deliverer Lambda function"
  type        = string
}

variable "ecs_cluster_arn" {
  description = "ARN of the ECS cluster to monitor for task state changes"
  type        = string
}

variable "schedule_enabled" {
  description = "Whether the daily schedule rule is enabled (set false for initial deploy)"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
