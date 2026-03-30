output "ecr_repository_url" {
  description = "ECR repository URL for summarizer image"
  value       = module.ecs.ecr_repository_url
}

output "cloudfront_domain" {
  description = "CloudFront distribution domain name"
  value       = module.s3_cloudfront.cloudfront_domain_name
}

output "detail_page_base_url" {
  description = "Base URL for detail pages"
  value       = module.s3_cloudfront.detail_page_base_url
}

output "pages_bucket_name" {
  description = "S3 bucket name for detail pages"
  value       = module.s3_cloudfront.bucket_name
}

output "codebuild_project_name" {
  description = "CodeBuild project name"
  value       = module.codebuild.project_name
}

output "slack_events_url" {
  description = "Slack Events API endpoint URL"
  value       = module.api_gateway.slack_events_url
}

output "github_actions_role_arn" {
  description = "IAM role ARN for GitHub Actions OIDC"
  value       = module.github_oidc.role_arn
}

output "vector_bucket_name" {
  description = "S3 Vectors bucket name"
  value       = module.s3_vectors.vector_bucket_name
}

output "vector_index_name" {
  description = "S3 Vectors index name"
  value       = module.s3_vectors.vector_index_name
}
