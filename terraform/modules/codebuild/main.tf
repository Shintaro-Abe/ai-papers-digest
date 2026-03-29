################################################################################
# CodeBuild Module - Docker Image Build + ECR Push
################################################################################

locals {
  project_name = "ai-papers-digest-build"
}

# ------------------------------------------------------------------------------
# IAM Role
# ------------------------------------------------------------------------------

data "aws_iam_policy_document" "assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codebuild" {
  name               = "${local.project_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "codebuild" {
  # CloudWatch Logs
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:aws:logs:*:*:log-group:/aws/codebuild/${local.project_name}*"]
  }

  # ECR login
  statement {
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # S3 source download
  statement {
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
    ]
    resources = ["arn:aws:s3:::*build*", "arn:aws:s3:::*build*/*", "arn:aws:s3:::ai-papers-digest-*/*"]
  }

  # ECR push
  statement {
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
    ]
    resources = [var.ecr_repository_arn]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name   = "${local.project_name}-policy"
  role   = aws_iam_role.codebuild.id
  policy = data.aws_iam_policy_document.codebuild.json
}

# ------------------------------------------------------------------------------
# CodeBuild Project
# ------------------------------------------------------------------------------

resource "aws_codebuild_project" "this" {
  name          = local.project_name
  description   = "Build and push ai-papers-digest summarizer Docker image"
  build_timeout = 15 # minutes
  service_role  = aws_iam_role.codebuild.arn

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type                = "BUILD_GENERAL1_SMALL"
    image                       = "aws/codebuild/amazonlinux2-aarch64-standard:3.0"
    type                        = "ARM_CONTAINER"
    privileged_mode             = true # Required for Docker builds
    image_pull_credentials_type = "CODEBUILD"

    environment_variable {
      name  = "ECR_REPOSITORY_URI"
      value = var.ecr_repository_url
    }

    environment_variable {
      name  = "AWS_DEFAULT_REGION"
      value = "ap-northeast-1"
    }
  }

  source {
    type            = "GITHUB"
    location        = var.source_location
    git_clone_depth = 1
    buildspec       = var.buildspec_path
  }

  logs_config {
    cloudwatch_logs {
      group_name  = "/aws/codebuild/${local.project_name}"
      stream_name = ""
    }
  }

  tags = var.tags
}
