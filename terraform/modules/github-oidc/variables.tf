variable "github_org" {
  description = "GitHub organization or user name"
  type        = string
}

variable "github_repo" {
  description = "GitHub repository name (without org prefix)"
  type        = string
}

variable "iam_role_name" {
  description = "Name of the IAM role for GitHub Actions"
  type        = string
  default     = "ai-papers-digest-github-actions-role"
}

variable "allowed_branches" {
  description = "List of branches allowed to assume the role"
  type        = list(string)
  default     = ["main"]
}

variable "policy_arns" {
  description = "List of IAM policy ARNs to attach to the role"
  type        = list(string)
  default     = []
}

variable "inline_policy_json" {
  description = "Inline IAM policy JSON document"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
