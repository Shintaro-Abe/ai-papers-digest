terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Data Sources ---

data "aws_caller_identity" "current" {}

# --- Lambda Layer (placeholder zip) ---

data "archive_file" "lambda_placeholder" {
  type        = "zip"
  output_path = "${path.module}/placeholder.zip"

  source {
    content  = "def handler(event, context): pass"
    filename = "handler.py"
  }
}

# --- Secrets Manager ---

resource "aws_secretsmanager_secret" "slack_webhook_url" {
  name = "ai-papers-digest/slack-webhook-url"
  tags = var.tags
}

resource "aws_secretsmanager_secret" "semantic_scholar_api_key" {
  name = "ai-papers-digest/semantic-scholar-api-key"
  tags = var.tags
}

resource "aws_secretsmanager_secret" "claude_auth_token" {
  name = "ai-papers-digest/claude-auth-token"
  tags = var.tags
}

resource "aws_secretsmanager_secret" "slack_bot_token" {
  name = "ai-papers-digest/slack-bot-token"
  tags = var.tags
}

resource "aws_secretsmanager_secret" "slack_signing_secret" {
  name = "ai-papers-digest/slack-signing-secret"
  tags = var.tags
}

# --- DynamoDB ---

module "dynamodb" {
  source = "../../modules/dynamodb"
  tags   = var.tags
}

# --- S3 + CloudFront ---

module "s3_cloudfront" {
  source      = "../../modules/s3-cloudfront"
  bucket_name = var.pages_bucket_name
  tags        = var.tags
}

# --- ECS ---

module "ecs" {
  source = "../../modules/ecs"

  ecr_image_uri          = "${module.ecs.ecr_repository_url}:latest"
  papers_table_name      = module.dynamodb.papers_table_name
  summaries_table_name   = module.dynamodb.summaries_table_name
  detail_page_base_url   = module.s3_cloudfront.detail_page_base_url
  secrets_manager_arn    = aws_secretsmanager_secret.claude_auth_token.arn
  dynamodb_table_arns    = [module.dynamodb.papers_table_arn, module.dynamodb.summaries_table_arn]
  s3_bucket_arn          = module.s3_cloudfront.bucket_arn
  s3_bucket_name         = module.s3_cloudfront.bucket_name
  vector_bucket_name     = module.s3_vectors.vector_bucket_name
  vector_bucket_arn      = module.s3_vectors.vector_bucket_arn
  vector_index_arn       = module.s3_vectors.vector_index_arn
  tags                   = var.tags
}

# --- S3 Vectors (Phase 3) ---

module "s3_vectors" {
  source = "../../modules/s3-vectors"
  tags   = var.tags
}

# --- Lambda: collector ---

module "lambda_collector" {
  source = "../../modules/lambda"

  function_name    = "ai-papers-digest-collector"
  timeout          = 300
  memory_size      = 256
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment_variables = {
    PAPERS_TABLE          = module.dynamodb.papers_table_name
    PAPER_SOURCES_TABLE   = module.dynamodb.paper_sources_table_name
    SCORER_FUNCTION_NAME  = "ai-papers-digest-scorer"
    S2_API_KEY_SECRET_ARN = aws_secretsmanager_secret.semantic_scholar_api_key.arn
    TARGET_CATEGORIES     = "cs.AI,cs.CL,cs.CV,cs.LG,stat.ML"
    LOG_LEVEL             = "INFO"
  }

  policy_statements = [
    {
      effect    = "Allow"
      actions   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem"]
      resources = [module.dynamodb.papers_table_arn, module.dynamodb.paper_sources_table_arn]
    },
    {
      effect    = "Allow"
      actions   = ["dynamodb:Query"]
      resources = ["${module.dynamodb.papers_table_arn}/index/*"]
    },
    {
      effect    = "Allow"
      actions   = ["lambda:InvokeFunction"]
      resources = [module.lambda_scorer.function_arn]
    },
    {
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [aws_secretsmanager_secret.semantic_scholar_api_key.arn]
    },
  ]

  reserved_concurrent_executions = 1
  tags                           = var.tags
}

# --- Lambda: scorer ---

module "lambda_scorer" {
  source = "../../modules/lambda"

  function_name    = "ai-papers-digest-scorer"
  timeout          = 120
  memory_size      = 256
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment_variables = {
    PAPERS_TABLE          = module.dynamodb.papers_table_name
    DELIVERY_LOG_TABLE    = module.dynamodb.delivery_log_table_name
    CONFIG_TABLE          = module.dynamodb.config_table_name
    ECS_CLUSTER           = module.ecs.cluster_name
    ECS_TASK_DEFINITION   = module.ecs.task_definition_arn
    ECS_SUBNETS           = join(",", module.ecs.subnet_ids)
    ECS_SECURITY_GROUP    = module.ecs.security_group_id
    FEEDBACK_TABLE        = module.dynamodb.feedback_table_name
    TOP_N                 = "7"
    LOG_LEVEL             = "INFO"
  }

  policy_statements = [
    {
      effect    = "Allow"
      actions   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:UpdateItem", "dynamodb:Scan"]
      resources = [
        module.dynamodb.papers_table_arn,
        "${module.dynamodb.papers_table_arn}/index/*",
        module.dynamodb.delivery_log_table_arn,
        module.dynamodb.config_table_arn,
        module.dynamodb.feedback_table_arn,
      ]
    },
    {
      effect    = "Allow"
      actions   = ["ecs:RunTask"]
      resources = ["arn:aws:ecs:ap-northeast-1:${data.aws_caller_identity.current.account_id}:task-definition/ai-papers-digest-summarizer:*"]
    },
    {
      effect    = "Allow"
      actions   = ["iam:PassRole"]
      resources = ["arn:aws:iam::${data.aws_caller_identity.current.account_id}:role/ai-papers-digest-*"]
    },
  ]

  tags = var.tags
}

# --- Lambda: deliverer ---

module "lambda_deliverer" {
  source = "../../modules/lambda"

  function_name    = "ai-papers-digest-deliverer"
  timeout          = 120
  memory_size      = 128
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment_variables = {
    SUMMARIES_TABLE            = module.dynamodb.summaries_table_name
    DELIVERY_LOG_TABLE         = module.dynamodb.delivery_log_table_name
    PAPERS_TABLE               = module.dynamodb.papers_table_name
    SLACK_BOT_TOKEN_SECRET_ARN = aws_secretsmanager_secret.slack_bot_token.arn
    SLACK_CHANNEL_ID           = "C0AQAJC41LG"
    DETAIL_PAGE_BASE_URL       = module.s3_cloudfront.detail_page_base_url
    LOG_LEVEL                  = "INFO"
  }

  policy_statements = [
    {
      effect    = "Allow"
      actions   = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Scan"]
      resources = [module.dynamodb.summaries_table_arn, module.dynamodb.delivery_log_table_arn]
    },
    {
      effect    = "Allow"
      actions   = ["dynamodb:BatchGetItem", "dynamodb:GetItem"]
      resources = [module.dynamodb.papers_table_arn]
    },
    {
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [aws_secretsmanager_secret.slack_bot_token.arn]
    },
  ]

  tags = var.tags
}

# --- Lambda: token_refresher ---

module "lambda_token_refresher" {
  source = "../../modules/lambda"

  function_name    = "ai-papers-digest-token-refresher"
  timeout          = 30
  memory_size      = 128
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment_variables = {
    CLAUDE_SECRET_ID = aws_secretsmanager_secret.claude_auth_token.arn
    LOG_LEVEL        = "INFO"
  }

  policy_statements = [
    {
      effect  = "Allow"
      actions = ["secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue"]
      resources = [aws_secretsmanager_secret.claude_auth_token.arn]
    },
  ]

  tags = var.tags
}

# --- EventBridge ---

module "eventbridge" {
  source = "../../modules/eventbridge"

  collector_lambda_arn  = module.lambda_collector.function_arn
  collector_lambda_name = module.lambda_collector.function_name
  deliverer_lambda_arn  = module.lambda_deliverer.function_arn
  deliverer_lambda_name = module.lambda_deliverer.function_name
  ecs_cluster_arn              = module.ecs.cluster_arn
  token_refresher_lambda_arn   = module.lambda_token_refresher.function_arn
  token_refresher_lambda_name  = module.lambda_token_refresher.function_name
  schedule_enabled             = true
  tags                         = var.tags
}

# --- Monitoring ---

module "monitoring" {
  source = "../../modules/monitoring"

  alert_email             = var.alert_email
  collector_function_name = module.lambda_collector.function_name
  scorer_function_name    = module.lambda_scorer.function_name
  deliverer_function_name = module.lambda_deliverer.function_name
  tags                    = var.tags
}

# --- Lambda: feedback (Phase 2) ---

module "lambda_feedback" {
  source = "../../modules/lambda"

  function_name    = "ai-papers-digest-feedback"
  timeout          = 30
  memory_size      = 128
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment_variables = {
    FEEDBACK_TABLE             = module.dynamodb.feedback_table_name
    DELIVERY_LOG_TABLE         = module.dynamodb.delivery_log_table_name
    SLACK_SIGNING_SECRET_ARN   = aws_secretsmanager_secret.slack_signing_secret.arn
    LOG_LEVEL                  = "INFO"
  }

  policy_statements = [
    {
      effect    = "Allow"
      actions   = ["dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:GetItem"]
      resources = [module.dynamodb.feedback_table_arn]
    },
    {
      effect    = "Allow"
      actions   = ["dynamodb:Scan", "dynamodb:Query", "dynamodb:UpdateItem"]
      resources = [module.dynamodb.delivery_log_table_arn]
    },
    {
      effect    = "Allow"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [aws_secretsmanager_secret.slack_signing_secret.arn]
    },
  ]

  tags = var.tags
}

# --- Lambda: weight-adjuster (Phase 2) ---

module "lambda_weight_adjuster" {
  source = "../../modules/lambda"

  function_name    = "ai-papers-digest-weight-adjuster"
  timeout          = 120
  memory_size      = 256
  filename         = data.archive_file.lambda_placeholder.output_path
  source_code_hash = data.archive_file.lambda_placeholder.output_base64sha256

  environment_variables = {
    FEEDBACK_TABLE = module.dynamodb.feedback_table_name
    PAPERS_TABLE   = module.dynamodb.papers_table_name
    CONFIG_TABLE   = module.dynamodb.config_table_name
    LOG_LEVEL      = "INFO"
  }

  policy_statements = [
    {
      effect    = "Allow"
      actions   = ["dynamodb:Scan", "dynamodb:Query"]
      resources = [
        module.dynamodb.feedback_table_arn,
        "${module.dynamodb.feedback_table_arn}/index/*",
        module.dynamodb.papers_table_arn,
      ]
    },
    {
      effect    = "Allow"
      actions   = ["dynamodb:GetItem", "dynamodb:PutItem"]
      resources = [module.dynamodb.config_table_arn]
    },
  ]

  tags = var.tags
}

# --- API Gateway (Phase 2) ---

module "api_gateway" {
  source = "../../modules/api-gateway"

  feedback_lambda_arn  = module.lambda_feedback.function_arn
  feedback_lambda_name = module.lambda_feedback.function_name
  tags                 = var.tags
}

# --- EventBridge: weekly weight adjuster (Phase 2) ---

resource "aws_cloudwatch_event_rule" "weekly_weight_adjuster" {
  name                = "ai-papers-digest-weekly-weight"
  description         = "Weekly weight adjustment - Monday JST 5:00 (UTC 20:00 Sunday)"
  schedule_expression = "cron(0 20 ? * SUN *)"
  tags                = var.tags
}

resource "aws_cloudwatch_event_target" "weight_adjuster" {
  rule = aws_cloudwatch_event_rule.weekly_weight_adjuster.name
  arn  = module.lambda_weight_adjuster.function_arn
}

resource "aws_lambda_permission" "allow_eventbridge_weight_adjuster" {
  statement_id  = "AllowEventBridgeInvokeWeightAdjuster"
  action        = "lambda:InvokeFunction"
  function_name = module.lambda_weight_adjuster.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weekly_weight_adjuster.arn
}

# --- GitHub OIDC (CI/CD 認証) ---

module "github_oidc" {
  source = "../../modules/github-oidc"

  github_org  = "Shintaro-Abe"
  github_repo = "ai-papers-digest"

  allowed_branches = ["main"]

  inline_policy_json = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TerraformState"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
        ]
        Resource = [
          "arn:aws:s3:::ai-papers-digest-tfstate-${data.aws_caller_identity.current.account_id}",
          "arn:aws:s3:::ai-papers-digest-tfstate-${data.aws_caller_identity.current.account_id}/*",
        ]
      },
      {
        Sid    = "TerraformLock"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem",
        ]
        Resource = "arn:aws:dynamodb:ap-northeast-1:${data.aws_caller_identity.current.account_id}:table/ai-papers-digest-tflock"
      },
      {
        Sid    = "TerraformPlan"
        Effect = "Allow"
        Action = [
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:ListTags",
          "lambda:GetPolicy",
          "lambda:ListVersionsByFunction",
          "dynamodb:DescribeTable",
          "dynamodb:DescribeContinuousBackups",
          "dynamodb:ListTagsOfResource",
          "ecs:Describe*",
          "ecs:List*",
          "ecr:Describe*",
          "ecr:GetRepositoryPolicy",
          "ecr:ListTagsForResource",
          "s3:GetBucket*",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetEncryptionConfiguration",
          "s3:GetLifecycleConfiguration",
          "s3:GetAccelerateConfiguration",
          "s3:GetBucketPolicy",
          "s3:GetBucketVersioning",
          "s3:GetBucketWebsite",
          "s3:GetBucketCORS",
          "s3:GetBucketLogging",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketTagging",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetReplicationConfiguration",
          "cloudfront:GetDistribution",
          "cloudfront:ListTagsForResource",
          "cloudfront:GetOriginAccessControl",
          "events:Describe*",
          "events:List*",
          "cloudwatch:Describe*",
          "cloudwatch:ListTagsForResource",
          "sns:Get*",
          "sns:ListTagsForResource",
          "sqs:GetQueueAttributes",
          "sqs:ListQueueTags",
          "logs:Describe*",
          "logs:ListTagsForResource",
          "iam:GetRole",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:ListAttachedRolePolicies",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:GetOpenIDConnectProvider",
          "secretsmanager:DescribeSecret",
          "secretsmanager:ListSecrets",
          "ec2:Describe*",
          "apigatewayv2:Get*",
          "codebuild:BatchGetProjects",
          "codebuild:ListBuilds*",
        ]
        Resource = "*"
      },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
        ]
        Resource = "*"
      },
      {
        Sid    = "S3StaticAssets"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ]
        Resource = [
          module.s3_cloudfront.bucket_arn,
          "${module.s3_cloudfront.bucket_arn}/*",
        ]
      },
      {
        Sid    = "CloudFrontInvalidation"
        Effect = "Allow"
        Action = ["cloudfront:CreateInvalidation"]
        Resource = "*"
      },
      {
        Sid    = "LambdaDeploy"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
        ]
        Resource = "arn:aws:lambda:ap-northeast-1:${data.aws_caller_identity.current.account_id}:function:ai-papers-digest-*"
      },
      {
        Sid    = "CodeBuildTrigger"
        Effect = "Allow"
        Action = [
          "codebuild:StartBuild",
          "codebuild:BatchGetBuilds",
        ]
        Resource = "arn:aws:codebuild:ap-northeast-1:${data.aws_caller_identity.current.account_id}:project/ai-papers-digest-*"
      },
    ]
  })

  tags = var.tags
}

# --- CodeBuild ---

module "codebuild" {
  source = "../../modules/codebuild"

  ecr_repository_url = module.ecs.ecr_repository_url
  ecr_repository_arn = module.ecs.ecr_repository_arn
  source_location    = var.github_repository_url
  tags               = var.tags
}
