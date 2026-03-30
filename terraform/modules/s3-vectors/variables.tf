variable "vector_bucket_name" {
  description = "Name of the S3 Vectors bucket"
  type        = string
  default     = "ai-papers-digest-vectors"
}

variable "vector_index_name" {
  description = "Name of the vector index"
  type        = string
  default     = "paper-embeddings"
}

variable "dimension" {
  description = "Number of dimensions for vector embeddings"
  type        = number
  default     = 1024
}

variable "distance_metric" {
  description = "Distance metric for similarity search (cosine or euclidean)"
  type        = string
  default     = "cosine"
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
