###############################################################################
# EventBridge Module - Main
###############################################################################

# -----------------------------------------------------------------------------
# Daily Schedule Rule (JST 6:00 = UTC 21:00)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "daily_schedule" {
  name                = "ai-papers-digest-daily"
  description         = "Triggers collector Lambda daily at JST 06:00 (UTC 21:00)"
  schedule_expression = "cron(0 21 * * ? *)"
  state               = var.schedule_enabled ? "ENABLED" : "DISABLED"

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "collector" {
  rule = aws_cloudwatch_event_rule.daily_schedule.name
  arn  = var.collector_lambda_arn
}

resource "aws_lambda_permission" "allow_eventbridge_collector" {
  statement_id  = "AllowEventBridgeInvokeCollector"
  action        = "lambda:InvokeFunction"
  function_name = var.collector_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_schedule.arn
}

# -----------------------------------------------------------------------------
# ECS Task State Change Rule
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "task_complete" {
  name        = "ai-papers-digest-task-complete"
  description = "Triggers deliverer Lambda when ECS scoring task completes successfully"

  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [var.ecs_cluster_arn]
      lastStatus = ["STOPPED"]
      containers = {
        exitCode = [0]
      }
    }
  })

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "deliverer" {
  rule = aws_cloudwatch_event_rule.task_complete.name
  arn  = var.deliverer_lambda_arn
}

resource "aws_lambda_permission" "allow_eventbridge_deliverer" {
  statement_id  = "AllowEventBridgeInvokeDeliverer"
  action        = "lambda:InvokeFunction"
  function_name = var.deliverer_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.task_complete.arn
}

# -----------------------------------------------------------------------------
# Token Refresh Schedule (every hour)
# -----------------------------------------------------------------------------
resource "aws_cloudwatch_event_rule" "token_refresh" {
  name                = "ai-papers-digest-token-refresh"
  description         = "Refreshes Claude OAuth token every hour"
  schedule_expression = "rate(1 hour)"
  state               = var.schedule_enabled ? "ENABLED" : "DISABLED"

  tags = var.tags
}

resource "aws_cloudwatch_event_target" "token_refresher" {
  rule = aws_cloudwatch_event_rule.token_refresh.name
  arn  = var.token_refresher_lambda_arn
}

resource "aws_lambda_permission" "allow_eventbridge_token_refresher" {
  statement_id  = "AllowEventBridgeInvokeTokenRefresher"
  action        = "lambda:InvokeFunction"
  function_name = var.token_refresher_lambda_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.token_refresh.arn
}
