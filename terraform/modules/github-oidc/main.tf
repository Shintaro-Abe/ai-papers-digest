################################################################################
# GitHub OIDC Provider + IAM Role for GitHub Actions
#
# AWS 推奨: 長期間有効なアクセスキーの代わりに OIDC + 一時認証情報を使用
# See: https://aws.amazon.com/blogs/security/use-iam-roles-to-connect-github-actions-to-actions-in-aws/
################################################################################

data "aws_caller_identity" "current" {}

# ------------------------------------------------------------------------------
# OIDC Provider
# GitHub の OIDC プロバイダーを AWS アカウントに登録
# アカウントにつき1つだけ作成（既存がある場合は data source で参照）
# ------------------------------------------------------------------------------

resource "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"

  client_id_list = ["sts.amazonaws.com"]

  # GitHub OIDC の thumbprint
  # See: https://github.blog/changelog/2023-06-27-github-actions-update-on-oidc-integration-with-aws/
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]

  tags = var.tags
}

# ------------------------------------------------------------------------------
# IAM Role for GitHub Actions
# 信頼ポリシーで特定のリポジトリ + ブランチのみに制限
# ------------------------------------------------------------------------------

locals {
  # 許可する sub クレーム条件
  # 形式: repo:{org}/{repo}:ref:refs/heads/{branch}
  allowed_subs = [
    for branch in var.allowed_branches :
    "repo:${var.github_org}/${var.github_repo}:ref:refs/heads/${branch}"
  ]

  # PR からのアクセスも許可（terraform plan 用）
  allowed_subs_with_pr = concat(
    local.allowed_subs,
    ["repo:${var.github_org}/${var.github_repo}:pull_request"]
  )
}

data "aws_iam_policy_document" "trust_policy" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.allowed_subs_with_pr
    }
  }
}

resource "aws_iam_role" "github_actions" {
  name               = var.iam_role_name
  assume_role_policy = data.aws_iam_policy_document.trust_policy.json
  max_session_duration = 3600 # 1時間

  tags = var.tags
}

# ------------------------------------------------------------------------------
# IAM Policy Attachments
# ------------------------------------------------------------------------------

resource "aws_iam_role_policy_attachment" "managed_policies" {
  count      = length(var.policy_arns)
  role       = aws_iam_role.github_actions.name
  policy_arn = var.policy_arns[count.index]
}

resource "aws_iam_role_policy" "inline_policy" {
  count  = var.inline_policy_json != "" ? 1 : 0
  name   = "${var.iam_role_name}-inline"
  role   = aws_iam_role.github_actions.id
  policy = var.inline_policy_json
}
