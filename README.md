# AI Papers Digest

AI 分野の最新論文を自動キュレーション・要約し、毎朝 Slack に配信するサーバーレスエージェント。

## 概要

- arXiv / Hugging Face / Semantic Scholar から日次で論文を収集
- 注目度スコアに基づき上位 7 本を自動選出
- Claude LLM でコンパクト要約（200〜400文字）+ 詳細要約（構造化 4 セクション）を生成
- Slack にコンパクト要約を配信し、詳細は S3 静的ページで閲覧
- 👍/👎 フィードバックで論文選定精度を継続改善
- 類似論文検索・タグ別閲覧・キーワード検索が可能な Web ダッシュボード

## アーキテクチャ

```
EventBridge(日次) → collector Lambda → scorer Lambda → Fargate(Claude CLI) → deliverer Lambda → Slack
                                                            │
                                                            ├→ S3 + CloudFront（詳細ページ・ダッシュボード）
                                                            ├→ Bedrock Titan V2（埋め込み生成）
                                                            └→ S3 Vectors（類似論文検索）

EventBridge(週次) → weight-adjuster Lambda（フィードバック学習）
Slack Events API → API Gateway → feedback Lambda（👍/👎 収集）
```

| コンポーネント | 技術 |
|--------------|------|
| データ収集・スコアリング・配信 | AWS Lambda（Python 3.12, arm64） |
| 要約生成 | ECS Fargate（Node.js 22 + Claude CLI, SPOT） |
| データストア | DynamoDB（6 テーブル） |
| 詳細ページ・ダッシュボード | S3 + CloudFront |
| ベクトル検索 | S3 Vectors + Bedrock Titan Embeddings V2 |
| IaC | Terraform（AWS provider ~> 6.0） |
| CI/CD | GitHub Actions + CodeBuild（ARM64） |
| 認証 | GitHub OIDC（CI/CD）、Claude OAuth（自動リフレッシュ） |

## 主要機能

### 論文収集・要約・配信

- 3 ソース（arXiv API, HuggingFace Papers, Semantic Scholar）からの並列収集
- スコアリング: `w1×hf_upvotes + w2×citations + w3×source_count + w4×feedback_bonus`
- Claude Max プラン（`claude -p` CLI）による 2 層要約生成
- Slack Bot Token + `chat.postMessage` で日次配信

### フィードバック学習

- Slack リアクション（👍/👎）によるフィードバック収集
- カテゴリベースの feedback_bonus（Laplace 平滑化）
- 週次ウェイト最適化（ベイズ平滑化 + EMA ブレンド）
- 安全策: 最低 5 件のフィードバックがないとウェイト変更しない

### Web ダッシュボード・セマンティック検索

- Bedrock Titan Embeddings V2（1024 次元）による論文埋め込み
- S3 Vectors でコサイン類似度検索 → 詳細ページに類似論文セクション
- タグ一覧・タグ別論文一覧ページ
- クライアントサイド検索（lunr.js + 日本語部分文字列検索フォールバック）

## ディレクトリ構成

```
src/
├── lambdas/           # Lambda 関数群（Python）
│   ├── collector/     #   論文収集
│   ├── scorer/        #   スコアリング・フィルタリング
│   ├── deliverer/     #   Slack 配信
│   ├── feedback/      #   フィードバック収集
│   └── weight_adjuster/ # ウェイト最適化
├── summarizer/        # Fargate コンテナ（Node.js）
│   ├── src/           #   要約・埋め込み・ダッシュボード生成
│   └── templates/     #   HTML テンプレート（5 種）
└── shared/            # 共有定数

terraform/
├── modules/           # 再利用可能モジュール（10 モジュール）
└── environments/prod/ # 本番環境構成（local バックエンド）

docs/                  # 設計ドキュメント（7 ファイル）
tests/                 # テスト（Python 67 件 + Node.js 66 件 = 133 件）
static/                # S3 静的アセット（CSS, search.js）
```

## セットアップ

### 前提

- AWS アカウント + AWS CLI 設定済み
- Claude Max プラン加入済み
- Python 3.12, Node.js 22, Terraform >= 1.9

### 1. シークレットの準備

[docs/secrets-setup.md](docs/secrets-setup.md) を参照し、以下を入手:
- Slack Bot Token + Signing Secret
- Semantic Scholar API Key
- Claude Max 認証トークン（`~/.claude/.credentials.json`）

### 2. インフラデプロイ

```bash
cd terraform/environments/prod
cp terraform.tfvars.example terraform.tfvars  # 変数を編集
terraform init
terraform apply
```

### 3. Docker イメージのビルド

```bash
# CodeBuild（ARM64）でビルド
aws codebuild start-build --project-name ai-papers-digest-build
```

### 4. Lambda デプロイ + 静的アセット

main ブランチへの push で自動実行（GitHub Actions）:
- Lambda 関数パッケージング + デプロイ
- CodeBuild トリガー（ARM64 Docker ビルド + ECR push）
- S3 静的アセット同期

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
pytest tests/unit/lambdas/ -v -o addopts=""     # Python（67 件）
node --test tests/unit/summarizer/               # Node.js（66 件）

# Lint
ruff check src/ && ruff format --check src/

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
