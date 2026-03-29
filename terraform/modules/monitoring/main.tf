###############################################################################
# Monitoring Module - Main
###############################################################################

# -----------------------------------------------------------------------------
# SNS Topic for Alerts
# -----------------------------------------------------------------------------
data "aws_caller_identity" "current" {}

resource "aws_sns_topic" "alerts" {
  name              = "ai-papers-digest-alerts"
  kms_master_key_id = "alias/aws/sns"
  tags              = var.tags
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# -----------------------------------------------------------------------------
# CloudWatch Alarm: Collector Lambda Errors
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "collector_errors" {
  alarm_name          = "ai-papers-digest-collector-errors"
  alarm_description   = "Collector Lambda function errors detected"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.collector_function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = var.tags
}

# -----------------------------------------------------------------------------
# CloudWatch Alarm: Scorer Lambda Errors
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "scorer_errors" {
  alarm_name          = "ai-papers-digest-scorer-errors"
  alarm_description   = "Scorer Lambda function errors detected"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.scorer_function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = var.tags
}

# -----------------------------------------------------------------------------
# CloudWatch Alarm: Deliverer Lambda Errors
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_metric_alarm" "deliverer_errors" {
  alarm_name          = "ai-papers-digest-deliverer-errors"
  alarm_description   = "Deliverer Lambda function errors detected"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 1
  treat_missing_data  = "notBreaching"

  dimensions = {
    FunctionName = var.deliverer_function_name
  }

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = var.tags
}
