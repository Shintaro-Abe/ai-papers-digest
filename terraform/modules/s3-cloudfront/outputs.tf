output "bucket_name" {
  description = "Name of the S3 bucket"
  value       = aws_s3_bucket.pages.id
}

output "bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.pages.arn
}

output "cloudfront_distribution_id" {
  description = "ID of the CloudFront distribution"
  value       = aws_cloudfront_distribution.pages.id
}

output "cloudfront_domain_name" {
  description = "Domain name of the CloudFront distribution"
  value       = aws_cloudfront_distribution.pages.domain_name
}

output "detail_page_base_url" {
  description = "Base URL for detail pages"
  value       = "https://${aws_cloudfront_distribution.pages.domain_name}"
}
