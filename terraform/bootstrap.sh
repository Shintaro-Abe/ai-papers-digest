#!/bin/bash
set -euo pipefail

# Terraform バックエンド用リソースを作成する bootstrap スクリプト
# 初回のみ手動で実行する（Terraform 管理外）

REGION="ap-northeast-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET_NAME="ai-papers-digest-tfstate-${ACCOUNT_ID}"
LOCK_TABLE="ai-papers-digest-tflock"

echo "=== Terraform Backend Bootstrap ==="
echo "Account ID: ${ACCOUNT_ID}"
echo "Region: ${REGION}"
echo "S3 Bucket: ${BUCKET_NAME}"
echo "DynamoDB Table: ${LOCK_TABLE}"
echo ""

# S3 バケット作成
echo "Creating S3 bucket..."
aws s3api create-bucket \
  --bucket "${BUCKET_NAME}" \
  --region "${REGION}" \
  --create-bucket-configuration LocationConstraint="${REGION}"

# バージョニング有効化
echo "Enabling versioning..."
aws s3api put-bucket-versioning \
  --bucket "${BUCKET_NAME}" \
  --versioning-configuration Status=Enabled

# パブリックアクセスブロック
echo "Blocking public access..."
aws s3api put-public-access-block \
  --bucket "${BUCKET_NAME}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# 暗号化設定
echo "Enabling encryption..."
aws s3api put-bucket-encryption \
  --bucket "${BUCKET_NAME}" \
  --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

# DynamoDB ロックテーブル作成
echo "Creating DynamoDB lock table..."
aws dynamodb create-table \
  --table-name "${LOCK_TABLE}" \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region "${REGION}"

echo ""
echo "=== Bootstrap complete ==="
echo "Update terraform/environments/prod/backend.tf with:"
echo "  bucket         = \"${BUCKET_NAME}\""
echo "  dynamodb_table = \"${LOCK_TABLE}\""
