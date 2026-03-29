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
