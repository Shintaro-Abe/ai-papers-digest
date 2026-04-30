################################################################################
# Lambda@Edge Module - Variables
################################################################################

variable "function_name" {
  description = "Name of the Lambda@Edge function"
  type        = string
  default     = "ai-papers-digest-auth-edge"
}

variable "user_pool_id" {
  description = "Cognito User Pool ID for JWT validation"
  type        = string
}

variable "client_id" {
  description = "Cognito App Client ID for JWT audience validation"
  type        = string
}

variable "cognito_region" {
  description = "AWS region of the Cognito User Pool"
  type        = string
  default     = "ap-northeast-1"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
}
