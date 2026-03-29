################################################################################
# Papers Table
################################################################################
resource "aws_dynamodb_table" "papers" {
  name         = "${var.table_name_prefix}-papers"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "arxiv_id"

  attribute {
    name = "arxiv_id"
    type = "S"
  }

  attribute {
    name = "collected_date"
    type = "S"
  }

  attribute {
    name = "score"
    type = "N"
  }

  global_secondary_index {
    name            = "score-index"
    hash_key        = "collected_date"
    range_key       = "score"
    projection_type = "ALL"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}

################################################################################
# Summaries Table
################################################################################
resource "aws_dynamodb_table" "summaries" {
  name         = "${var.table_name_prefix}-summaries"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "arxiv_id"
  range_key    = "summary_version"

  attribute {
    name = "arxiv_id"
    type = "S"
  }

  attribute {
    name = "summary_version"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}

################################################################################
# Delivery Log Table
################################################################################
resource "aws_dynamodb_table" "delivery_log" {
  name         = "${var.table_name_prefix}-delivery-log"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"
  range_key    = "arxiv_id"

  attribute {
    name = "date"
    type = "S"
  }

  attribute {
    name = "arxiv_id"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}

################################################################################
# Paper Sources Table
################################################################################
resource "aws_dynamodb_table" "paper_sources" {
  name         = "${var.table_name_prefix}-paper-sources"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "arxiv_id"
  range_key    = "source"

  attribute {
    name = "arxiv_id"
    type = "S"
  }

  attribute {
    name = "source"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}

################################################################################
# Config Table
################################################################################
resource "aws_dynamodb_table" "config" {
  name         = "${var.table_name_prefix}-config"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "key"

  attribute {
    name = "key"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  tags = var.tags
}
