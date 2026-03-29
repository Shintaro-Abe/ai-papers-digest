# AI Papers Digest

AI 分野の最新論文を自動キュレーション・要約し、毎朝 Slack に配信するサーバーレスエージェント。

## 概要

- arXiv / Hugging Face / Semantic Scholar から日次で論文を収集
- 注目度スコアに基づき上位 5〜10 本を自動選出
- Claude LLM でコンパクト要約（200〜400文字）+ 詳細要約（構造化 4 セクション）を生成
- Slack にコンパクト要約を配信し、詳細は S3 静的ページで閲覧

## アーキテクチャ

```
EventBridge(日次) → collector Lambda → scorer Lambda → Fargate(Claude CLI) → deliverer Lambda → Slack
                                                            ↓
                                                     S3 + CloudFront（詳細ページ）
```

| コンポーネント | 技術 |
|--------------|------|
| データ収集・スコアリング・配信 | AWS Lambda（Python 3.12） |
| 要約生成 | ECS Fargate（Node.js 22 + Claude CLI） |
| データストア | DynamoDB |
| 詳細ページ | S3 + CloudFront |
| IaC | Terraform |
| CI/CD | GitHub Actions |

## ディレクトリ構成

```
src/
├── lambdas/           # Lambda 関数群（Python）
│   ├── collector/     #   論文収集
│   ├── scorer/        #   スコアリング・フィルタリング
│   ├── deliverer/     #   Slack 配信
│   └── layer/         #   共通依存パッケージ
├── summarizer/        # Fargate コンテナ（Node.js）
│   ├── src/           #   要約生成 + HTML 生成
│   └── templates/     #   詳細ページテンプレート
└── shared/            # 共有定数

terraform/
├── modules/           # 再利用可能モジュール
└── environments/prod/ # 本番環境構成

docs/                  # 設計ドキュメント
tests/                 # ユニット・統合テスト
static/                # S3 静的アセット（CSS）
```

## セットアップ

### 前提

- AWS アカウント + AWS CLI 設定済み
- Claude Max プラン加入済み
- Python 3.12, Node.js 22, Terraform >= 1.9, Docker

### 1. シークレットの準備

[docs/secrets-setup.md](docs/secrets-setup.md) を参照し、以下を入手:
- Slack Incoming Webhook URL
- Semantic Scholar API Key
- Claude Max 認証トークン

### 2. インフラデプロイ

```bash
# Terraform 初期化・適用
cd terraform/environments/prod
cp terraform.tfvars.example terraform.tfvars  # 変数を編集
terraform init
terraform apply

# シークレット値を登録
aws secretsmanager put-secret-value --secret-id ai-papers-digest/slack-webhook-url --secret-string "..."
aws secretsmanager put-secret-value --secret-id ai-papers-digest/semantic-scholar-api-key --secret-string "..."
aws secretsmanager put-secret-value --secret-id ai-papers-digest/claude-auth-token --secret-string "..."
```

### 3. Docker イメージのビルド・プッシュ

```bash
ECR_URI=$(cd terraform/environments/prod && terraform output -raw ecr_repository_url)
docker build -t summarizer src/summarizer/
docker tag summarizer $ECR_URI:$(git rev-parse --short HEAD)
docker push $ECR_URI:$(git rev-parse --short HEAD)
```

### 4. 静的アセットのデプロイ

```bash
BUCKET=$(cd terraform/environments/prod && terraform output -raw pages_bucket_name)
aws s3 sync static/ s3://$BUCKET/assets/
```

### 5. 動作確認

```bash
# collector を手動実行
aws lambda invoke --function-name ai-papers-digest-collector --payload '{}' /dev/stdout
```

## 開発

```bash
# Python 環境
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

# テスト実行
PYTHONPATH=. pytest tests/unit/ -v -o addopts=""    # Python
node --test tests/unit/summarizer/                   # Node.js

# Lint
ruff check src/ && ruff format --check src/

# シークレットスキャン（pre-commit hook 設定）
git config core.hooksPath .githooks
# 手動スキャン
gitleaks detect --config .gitleaks.toml --verbose

# Terraform
cd terraform/environments/prod && terraform plan
```

## ドキュメント

| ファイル | 内容 |
|---------|------|
| [docs/product-requirements.md](docs/product-requirements.md) | プロダクト要求定義書 |
| [docs/functional-design.md](docs/functional-design.md) | 機能設計書 |
| [docs/architecture.md](docs/architecture.md) | 技術仕様書 |
| [docs/repository-structure.md](docs/repository-structure.md) | リポジトリ構造定義書 |
| [docs/development-guidelines.md](docs/development-guidelines.md) | 開発ガイドライン |
| [docs/glossary.md](docs/glossary.md) | ユビキタス言語定義 |
| [docs/secrets-setup.md](docs/secrets-setup.md) | シークレットセットアップガイド |

## ライセンス

MIT
