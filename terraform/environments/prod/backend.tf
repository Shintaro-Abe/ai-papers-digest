terraform {
  backend "local" {}

  # S3 バックエンドに移行する場合は以下のコメントを解除し、上の local を削除する
  # backend "s3" {
  #   bucket         = "ai-papers-digest-tfstate-ACCOUNT_ID"
  #   key            = "prod/terraform.tfstate"
  #   region         = "ap-northeast-1"
  #   dynamodb_table = "ai-papers-digest-tflock"
  #   encrypt        = true
  # }
}
