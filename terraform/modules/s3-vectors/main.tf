################################################################################
# S3 Vectors Module — Vector Bucket + Vector Index
#
# ゼロスケール・従量課金のベクトルストア
# 論文の埋め込みベクトルを保存し、類似度検索を実行する
################################################################################

# ------------------------------------------------------------------------------
# Vector Bucket
# ------------------------------------------------------------------------------

resource "aws_s3vectors_vector_bucket" "this" {
  vector_bucket_name = var.vector_bucket_name

  tags = var.tags
}

# ------------------------------------------------------------------------------
# Vector Index
# ------------------------------------------------------------------------------

resource "aws_s3vectors_index" "paper_embeddings" {
  vector_bucket_name = aws_s3vectors_vector_bucket.this.vector_bucket_name
  index_name         = var.vector_index_name

  dimension       = var.dimension
  distance_metric = var.distance_metric
  data_type       = "float32"

  tags = var.tags
}
