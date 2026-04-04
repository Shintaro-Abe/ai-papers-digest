################################################################################
# S3 Bucket
################################################################################

resource "aws_s3_bucket" "pages" {
  bucket = var.bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "pages" {
  bucket = aws_s3_bucket.pages.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "pages" {
  bucket = aws_s3_bucket.pages.id

  versioning_configuration {
    status = "Disabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "pages" {
  bucket = aws_s3_bucket.pages.id

  rule {
    id     = "intelligent-tiering"
    status = "Enabled"

    filter {}

    transition {
      days          = 90
      storage_class = "INTELLIGENT_TIERING"
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "pages" {
  bucket = aws_s3_bucket.pages.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

################################################################################
# CloudFront Origin Access Control
################################################################################

resource "aws_cloudfront_origin_access_control" "pages" {
  name                              = var.bucket_name
  description                       = "OAC for ${var.bucket_name}"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

################################################################################
# S3 Bucket Policy - Allow CloudFront via OAC
################################################################################

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "pages_bucket_policy" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.pages.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.pages.arn]
    }
  }
}

resource "aws_s3_bucket_policy" "pages" {
  bucket = aws_s3_bucket.pages.id
  policy = data.aws_iam_policy_document.pages_bucket_policy.json
}

################################################################################
# CloudFront Distribution
################################################################################

resource "aws_cloudfront_distribution" "pages" {
  comment             = "AI Papers Digest - Detail Pages"
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_200"
  tags                = var.tags

  origin {
    domain_name              = aws_s3_bucket.pages.bucket_regional_domain_name
    origin_id                = "S3-${var.bucket_name}"
    origin_access_control_id = aws_cloudfront_origin_access_control.pages.id
  }

  default_cache_behavior {
    target_origin_id       = "S3-${var.bucket_name}"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true

    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "whitelist"
      locations        = ["JP"]
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
