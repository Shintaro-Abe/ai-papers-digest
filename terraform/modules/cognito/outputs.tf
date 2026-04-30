################################################################################
# Cognito Module - Outputs
################################################################################

output "user_pool_id" {
  description = "ID of the Cognito User Pool"
  value       = aws_cognito_user_pool.this.id
}

output "user_pool_arn" {
  description = "ARN of the Cognito User Pool"
  value       = aws_cognito_user_pool.this.arn
}

output "user_pool_endpoint" {
  description = "Endpoint of the Cognito User Pool (used as JWT issuer)"
  value       = aws_cognito_user_pool.this.endpoint
}

output "client_id" {
  description = "ID of the Cognito User Pool Client"
  value       = aws_cognito_user_pool_client.web.id
}

output "domain" {
  description = "Cognito Hosted UI domain (without https://)"
  value       = "${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.id}.amazoncognito.com"
}

output "hosted_ui_login_url" {
  description = "Cognito Hosted UI login URL prefix (append OAuth params)"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.id}.amazoncognito.com/login"
}

output "hosted_ui_logout_url" {
  description = "Cognito Hosted UI logout URL prefix (append OAuth params)"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.id}.amazoncognito.com/logout"
}

output "token_endpoint" {
  description = "Cognito OAuth2 token endpoint URL"
  value       = "https://${aws_cognito_user_pool_domain.this.domain}.auth.${data.aws_region.current.id}.amazoncognito.com/oauth2/token"
}

output "jwks_url" {
  description = "JWKS URL for fetching the User Pool's public keys"
  value       = "https://cognito-idp.${data.aws_region.current.id}.amazonaws.com/${aws_cognito_user_pool.this.id}/.well-known/jwks.json"
}

output "issuer" {
  description = "JWT issuer URL"
  value       = "https://cognito-idp.${data.aws_region.current.id}.amazonaws.com/${aws_cognito_user_pool.this.id}"
}

data "aws_region" "current" {}
