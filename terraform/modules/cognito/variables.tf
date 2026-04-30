################################################################################
# Cognito Module - Variables
################################################################################

variable "user_pool_name" {
  description = "Name of the Cognito User Pool"
  type        = string
}

variable "domain_prefix" {
  description = "Cognito Hosted UI domain prefix (must be globally unique within the AWS region)"
  type        = string
}

variable "callback_urls" {
  description = "List of allowed callback URLs for the OAuth flow"
  type        = list(string)
}

variable "logout_urls" {
  description = "List of allowed sign-out URLs"
  type        = list(string)
}

variable "admin_email" {
  description = "Email address of the initial admin user (created with a temporary password)"
  type        = string
}

variable "id_token_validity_minutes" {
  description = "ID token validity in minutes"
  type        = number
  default     = 60
}

variable "access_token_validity_minutes" {
  description = "Access token validity in minutes"
  type        = number
  default     = 60
}

variable "refresh_token_validity_days" {
  description = "Refresh token validity in days. Kept short to limit blast radius if the token is stolen; pair with refresh token rotation."
  type        = number
  default     = 7
}

variable "refresh_token_rotation_grace_seconds" {
  description = "Grace period (seconds) where the previous refresh token remains valid after rotation, to absorb retries."
  type        = number
  default     = 60
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
}
