###############################################################################
# EventBridge Module - Outputs
###############################################################################

output "daily_schedule_arn" {
  description = "ARN of the daily schedule EventBridge rule"
  value       = aws_cloudwatch_event_rule.daily_schedule.arn
}

output "task_complete_rule_arn" {
  description = "ARN of the ECS task completion EventBridge rule"
  value       = aws_cloudwatch_event_rule.task_complete.arn
}
