################################################################################
# Lambda@Edge Module - Cognito JWT Validator (us-east-1 only)
################################################################################
#
# This module deploys a Lambda@Edge function in us-east-1 that validates
# Cognito-issued id_tokens at CloudFront viewer-request. The bundled
# `aws-jwt-verify` library fetches Cognito JWKS at first invocation and caches
# it within the Lambda container.

terraform {
  required_providers {
    aws = {
      source                = "hashicorp/aws"
      configuration_aliases = [aws.us_east_1]
    }
  }
}

# 1. Render index.js with templated values (USER_POOL_ID, CLIENT_ID embedded
#    because Lambda@Edge does not support environment variables).

locals {
  index_js_rendered = templatefile("${path.module}/auth/index.js.tftpl", {
    USER_POOL_ID = var.user_pool_id
    CLIENT_ID    = var.client_id
    REGION       = var.cognito_region
  })
}

# 2. Build a deterministic zip from auth/ + rendered index.js.
#    `null_resource` runs `npm ci --omit=dev` to populate node_modules, and
#    `archive_file` zips the result.

resource "local_file" "rendered_index" {
  content  = local.index_js_rendered
  filename = "${path.module}/auth/index.js"
}

resource "null_resource" "npm_install" {
  triggers = {
    package_json      = filesha256("${path.module}/auth/package.json")
    package_lock_json = fileexists("${path.module}/auth/package-lock.json") ? filesha256("${path.module}/auth/package-lock.json") : ""
  }

  provisioner "local-exec" {
    command     = "npm ci --omit=dev --no-audit --no-fund"
    working_dir = "${path.module}/auth"
  }
}

data "archive_file" "auth_edge_zip" {
  type        = "zip"
  source_dir  = "${path.module}/auth"
  output_path = "${path.module}/auth-edge.zip"
  excludes    = ["index.js.tftpl", "auth-edge.zip"]

  depends_on = [
    local_file.rendered_index,
    null_resource.npm_install,
  ]
}

# 3. IAM execution role — must allow both lambda.amazonaws.com (build/deploy)
#    and edgelambda.amazonaws.com (replication) to assume.

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "auth_edge" {
  provider           = aws.us_east_1
  name               = "${var.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic" {
  provider   = aws.us_east_1
  role       = aws_iam_role.auth_edge.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# 4. Lambda function (us-east-1) with publish=true so we get a versioned ARN
#    that CloudFront can reference. Lambda@Edge does NOT accept $LATEST.

resource "aws_lambda_function" "auth_edge" {
  provider         = aws.us_east_1
  function_name    = var.function_name
  role             = aws_iam_role.auth_edge.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  memory_size      = 128
  timeout          = 5
  filename         = data.archive_file.auth_edge_zip.output_path
  source_code_hash = data.archive_file.auth_edge_zip.output_base64sha256
  publish          = true

  tags = var.tags

  # Lambda@Edge does NOT support env vars — values are templated into index.js.

  lifecycle {
    create_before_destroy = true
  }
}
