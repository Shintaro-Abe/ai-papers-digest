################################################################################
# Cognito Module - User Pool, Client, Domain, Initial User
################################################################################

resource "aws_cognito_user_pool" "this" {
  name = var.user_pool_name

  # Sign-up disabled (admin-only user creation)
  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  # Email-based sign-in
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  # Strong password policy
  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  # MFA disabled initially (can be set to OPTIONAL later without recreate)
  mfa_configuration = "OFF"

  # Account recovery
  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  # Email verification message
  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
    email_subject        = "AI Papers Digest - メール認証"
    email_message        = "認証コード: {####}"
  }

  tags = var.tags
}

resource "aws_cognito_user_pool_domain" "this" {
  domain       = var.domain_prefix
  user_pool_id = aws_cognito_user_pool.this.id
}

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.user_pool_name}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  # PKCE flow (no client secret)
  generate_secret = false

  # OAuth 2.0 Authorization Code flow only
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["openid", "email"]

  callback_urls = var.callback_urls
  logout_urls   = var.logout_urls

  supported_identity_providers = ["COGNITO"]

  # Token validity
  id_token_validity      = var.id_token_validity_minutes
  access_token_validity  = var.access_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days

  token_validity_units {
    id_token      = "minutes"
    access_token  = "minutes"
    refresh_token = "days"
  }

  # Prevent user existence error responses (OWASP best practice)
  prevent_user_existence_errors = "ENABLED"

  # ALLOW_REFRESH_TOKEN_AUTH is implicit when refresh_token_rotation is
  # enabled and must NOT be listed here (Cognito rejects the combination).
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
  ]

  # Refresh token rotation: each refresh issues a new refresh token and
  # invalidates the old one (after a short grace period). Limits replay if a
  # refresh token is stolen.
  refresh_token_rotation {
    feature                    = "ENABLED"
    retry_grace_period_seconds = var.refresh_token_rotation_grace_seconds
  }
}

# Initial admin user.
# Cognito sends a welcome email with a generated temporary password.
# On first sign-in, the user is required to set a permanent password.
resource "aws_cognito_user" "admin" {
  user_pool_id = aws_cognito_user_pool.this.id
  username     = var.admin_email

  attributes = {
    email          = var.admin_email
    email_verified = true
  }

  # message_action omitted -> default RESEND behavior: Cognito emails the temporary password
  # temporary_password omitted -> Cognito generates one

  lifecycle {
    ignore_changes = [attributes]
  }
}
