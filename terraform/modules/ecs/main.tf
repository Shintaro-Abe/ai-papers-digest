################################################################################
# ECS Module - Main
################################################################################

data "aws_region" "current" {}
data "aws_caller_identity" "current" {}

locals {
  name_prefix = "ai-papers-digest"
}

################################################################################
# VPC
################################################################################

resource "aws_vpc" "this" {
  cidr_block           = "10.0.0.0/24"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-vpc"
  })
}

resource "aws_subnet" "public_a" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.0.0.0/25"
  availability_zone       = "ap-northeast-1a"
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-public-a"
  })
}

resource "aws_subnet" "public_c" {
  vpc_id                  = aws_vpc.this.id
  cidr_block              = "10.0.0.128/25"
  availability_zone       = "ap-northeast-1c"
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-public-c"
  })
}

resource "aws_internet_gateway" "this" {
  vpc_id = aws_vpc.this.id

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-igw"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.this.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.this.id
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-public-rt"
  })
}

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "public_c" {
  subnet_id      = aws_subnet.public_c.id
  route_table_id = aws_route_table.public.id
}

################################################################################
# Security Group
################################################################################

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name_prefix}-ecs-tasks-sg"
  description = "Security group for ECS tasks"
  vpc_id      = aws_vpc.this.id

  egress {
    description = "Allow HTTPS outbound"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, {
    Name = "${local.name_prefix}-ecs-tasks-sg"
  })
}

################################################################################
# CloudWatch Log Group
################################################################################

resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/ai-papers-digest"
  retention_in_days = 30

  tags = var.tags
}

################################################################################
# ECR Repository
################################################################################

resource "aws_ecr_repository" "summarizer" {
  name                 = "ai-papers-digest-summarizer"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = var.tags
}

################################################################################
# IAM - Task Execution Role
################################################################################

data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name_prefix}-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "task_execution_custom" {
  statement {
    sid    = "ECRPull"
    effect = "Allow"
    actions = [
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchGetImage",
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "CloudWatchLogs"
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.ecs.arn}:*"]
  }

  statement {
    sid    = "SecretsManagerRead"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
    ]
    resources = [var.secrets_manager_arn]
  }
}

resource "aws_iam_role_policy" "task_execution_custom" {
  name   = "${local.name_prefix}-task-execution-custom"
  role   = aws_iam_role.task_execution.id
  policy = data.aws_iam_policy_document.task_execution_custom.json
}

################################################################################
# IAM - Task Role
################################################################################

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json

  tags = var.tags
}

data "aws_iam_policy_document" "task" {
  statement {
    sid    = "DynamoDBReadWrite"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = var.dynamodb_table_arns
  }

  statement {
    sid    = "S3PutObject"
    effect = "Allow"
    actions = [
      "s3:PutObject",
    ]
    resources = ["${var.s3_bucket_arn}/*"]
  }

  statement {
    sid    = "SecretsManagerReadWrite"
    effect = "Allow"
    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
    ]
    resources = [var.secrets_manager_arn]
  }

  # Phase 3: S3 Vectors
  dynamic "statement" {
    for_each = var.vector_bucket_arn != "" ? [1] : []
    content {
      sid    = "S3VectorsReadWrite"
      effect = "Allow"
      actions = [
        "s3vectors:PutVectors",
        "s3vectors:GetVectors",
        "s3vectors:QueryVectors",
        "s3vectors:DeleteVectors",
        "s3vectors:ListVectors",
      ]
      resources = [
        var.vector_bucket_arn,
        var.vector_index_arn,
      ]
    }
  }

  # Phase 3: Bedrock Titan Embeddings
  dynamic "statement" {
    for_each = var.vector_bucket_arn != "" ? [1] : []
    content {
      sid    = "BedrockInvokeModel"
      effect = "Allow"
      actions = [
        "bedrock:InvokeModel",
      ]
      resources = ["arn:aws:bedrock:ap-northeast-1::foundation-model/amazon.titan-embed-text-v2:0"]
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name_prefix}-task-policy"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

################################################################################
# ECS Cluster
################################################################################

resource "aws_ecs_cluster" "this" {
  name = local.name_prefix

  tags = var.tags
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name = aws_ecs_cluster.this.name

  capacity_providers = ["FARGATE_SPOT", "FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 0
    base              = 0
  }
}

################################################################################
# ECS Task Definition
################################################################################

resource "aws_ecs_task_definition" "summarizer" {
  family                   = "ai-papers-digest-summarizer"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "ARM64"
  }

  container_definitions = jsonencode([
    {
      name      = "summarizer"
      image     = var.ecr_image_uri
      essential = true

      environment = [
        {
          name  = "PAPERS_TABLE"
          value = var.papers_table_name
        },
        {
          name  = "SUMMARIES_TABLE"
          value = var.summaries_table_name
        },
        {
          name  = "DETAIL_PAGE_BASE_URL"
          value = var.detail_page_base_url
        },
        {
          name  = "PAGES_BUCKET"
          value = var.s3_bucket_name
        },
        {
          name  = "VECTOR_BUCKET"
          value = var.vector_bucket_name
        },
        {
          name  = "VECTOR_INDEX"
          value = "paper-embeddings"
        },
        {
          name  = "CLAUDE_SECRET_ID"
          value = var.secrets_manager_arn
        },
      ]

      secrets = [
        {
          name      = "CLAUDE_ACCESS_TOKEN"
          valueFrom = var.secrets_manager_arn
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
          "awslogs-region"        = data.aws_region.current.name
          "awslogs-stream-prefix" = "ecs"
        }
      }
    }
  ])

  tags = var.tags
}
