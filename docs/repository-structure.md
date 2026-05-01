# リポジトリ構造定義書

## 1. 全体構成

```
ai-papers-digest/
│
├── docs/                              # 永続的ドキュメント
├── .steering/                         # 作業単位のドキュメント
│
├── src/                               # アプリケーションコード
│   ├── lambdas/                       #   Lambda 関数群（Python）
│   ├── summarizer/                    #   Fargate 要約生成コンテナ（Node.js）
│   └── shared/                        #   共有ユーティリティ
│
├── terraform/                         # IaC（Terraform）
│   ├── modules/                       #   再利用可能モジュール
│   └── environments/                  #   環境別構成
│
├── .github/                           # GitHub Actions ワークフロー
├── tests/                             # テストコード
│
├── CLAUDE.md                          # Claude Code プロジェクト設定
├── README.md                          # プロジェクト概要
├── .gitignore                         # Git 除外設定
└── LICENSE                            # ライセンス
```

## 2. ディレクトリ詳細

### `src/` — アプリケーションコード

```
src/
├── lambdas/                           # Lambda 関数群
│   ├── collector/                     # 論文収集 Lambda
│   │   ├── handler.py                 #   エントリポイント（JST/UTC日付分離、バックフィル対応）
│   │   ├── arxiv_client.py            #   arXiv API クライアント
│   │   ├── hf_client.py               #   Hugging Face API クライアント
│   │   ├── s2_client.py               #   Semantic Scholar API クライアント
│   │   ├── paper_merger.py            #   論文統合・重複排除（HF日付間+HF/arXiv間）
│   │   └── requirements.txt           #   依存パッケージ
│   │
│   ├── scorer/                        # スコアリング Lambda
│   │   ├── handler.py                 #   エントリポイント
│   │   ├── scoring.py                 #   スコア算出ロジック
│   │   ├── filter.py                  #   フィルタリングロジック
│   │   └── requirements.txt
│   │
│   ├── deliverer/                     # Slack 配信 Lambda
│   │   ├── handler.py                 #   エントリポイント
│   │   ├── slack_client.py            #   Slack Block Kit メッセージ構築
│   │   ├── message_builder.py         #   コンパクト要約メッセージ生成
│   │   └── requirements.txt
│   │
│   ├── feedback/                      # フィードバック収集 Lambda【Phase 2】
│   │   ├── handler.py                 #   エントリポイント
│   │   ├── slack_verifier.py          #   Slack 署名検証
│   │   ├── reaction_parser.py         #   リアクションイベント解析
│   │   └── requirements.txt
│   │
│   ├── weight_adjuster/               # ウェイト再計算 Lambda【Phase 2】
│   │   ├── handler.py                 #   エントリポイント。pipeline-runs に upsert + scoring_weights_history を 12 件循環で保持
│   │   ├── weight_optimizer.py        #   ウェイト最適化ロジック
│   │   └── requirements.txt
│   │
│   └── token_refresher/               # Claude OAuth トークン自動リフレッシュ Lambda
│       ├── handler.py                 #   エントリポイント。Secrets Manager 上の credentials を期限前に refresh
│       └── requirements.txt
│
├── summarizer/                        # Fargate 要約生成コンテナ（Node.js）
│   ├── Dockerfile                     #   コンテナイメージ定義
│   ├── entrypoint.sh                  #   エントリポイント（トークン配置・書き戻し）
│   ├── buildspec.yml                  #   CodeBuild ビルド仕様
│   ├── package.json                   #   npm 依存定義
│   ├── src/
│   │   ├── summarizer.js              #   メインエントリポイント
│   │   ├── claude-client.js           #   claude -p CLI ラッパー（usage トークン/コスト抽出含む）
│   │   ├── dynamo-client.js           #   DynamoDB 読み書き（summaries に quality_winner / quality_score 保存）
│   │   ├── s3-uploader.js             #   S3 HTML アップロード
│   │   ├── html-generator.js          #   HTML テンプレートレンダリング
│   │   ├── quality-judge.js           #   LLM-as-judge 品質比較（winner: claude/hf、usage 返却）
│   │   ├── embedding-client.js        #   Bedrock Titan Embeddings V2（1024次元）【Phase 3】
│   │   ├── vectors-client.js          #   S3 Vectors 読み書き・類似検索【Phase 3】
│   │   ├── dashboard-generator.js     #   ダッシュボードページ生成【Phase 3】
│   │   └── pipeline-runs.js           #   pipeline-runs テーブルへの upsert（Python 版と同等のセマンティクス）
│   └── templates/
│       ├── paper-detail.html          #   論文詳細ページテンプレート（類似論文付き）
│       ├── daily-digest.html          #   日次ダイジェストページテンプレート
│       ├── tag-list.html              #   タグ一覧ページテンプレート【Phase 3】
│       ├── tag-page.html              #   タグ別論文一覧テンプレート【Phase 3】
│       └── search.html                #   検索ページテンプレート【Phase 3】
│
└── shared/                            # 共有ユーティリティ（deploy.yml が各 Lambda zip に flat 同梱）
    ├── constants.py                   #   定数定義（テーブル名プレフィックス、カテゴリ一覧等）
    └── pipeline_runs.py               #   pipeline-runs upsert ヘルパー（DynamoDB 予約語エスケープ + 失敗握り潰し + retry 成功時の error クリア）
```

### `terraform/` — IaC

```
terraform/
├── main.tf                            # ルートレベル（使用しない、environments/ から参照）
├── variables.tf
├── outputs.tf
│
├── modules/
│   ├── dynamodb/                      # DynamoDB テーブル群
│   │   ├── main.tf                    #   papers, summaries, feedback, delivery_log, paper_sources, config, pipeline_runs (TTL 90日)
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── lambda/                        # Lambda 関数（共通モジュール）
│   │   ├── main.tf                    #   関数定義、IAMロール、DLQ
│   │   ├── variables.tf               #   関数名、ハンドラ、環境変数等をパラメータ化
│   │   └── outputs.tf
│   │
│   ├── ecs/                           # ECS クラスター + Fargate タスク定義
│   │   ├── main.tf                    #   クラスター、タスク定義、IAMロール、SG
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── s3-cloudfront/                 # S3 バケット + CloudFront ディストリビューション
│   │   ├── main.tf                    #   バケット、OAC、ディストリビューション、Geo制限
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── eventbridge/                   # EventBridge スケジュール + イベントルール
│   │   ├── main.tf                    #   日次/週次スケジュール、ECS状態変更ルール
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── monitoring/                    # CloudWatch + SNS
│   │   ├── main.tf                    #   Alarms、ロググループ、SNSトピック
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── api-gateway/                   # API Gateway【Phase 2】
│   │   ├── main.tf                    #   HTTP API、ルート、スロットリング
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── cognito/                       # Cognito User Pool + App Client + Domain
│   │   ├── main.tf                    #   PKCE 必須、code grant only、refresh token 7 日 + ローテーション、初期管理者ユーザー
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── lambda-edge/                   # Lambda@Edge（CloudFront viewer-request で JWT 検証）
│   │   ├── main.tf                    #   us-east-1 alias、aws-jwt-verify による RS256 検証、archive_file で zip 化
│   │   ├── auth/
│   │   │   ├── index.js.tftpl         #   Cognito IDs を埋め込むテンプレート
│   │   │   ├── package.json           #   aws-jwt-verify 依存
│   │   │   └── package-lock.json
│   │   ├── variables.tf
│   │   └── outputs.tf                 #   qualified_arn (versioned)
│   │
│   ├── s3-vectors/                    # S3 Vectors ベクトル検索【Phase 3】
│   │   ├── main.tf                    #   vector bucket、vector index（1024次元、cosine）
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   ├── github-oidc/                   # GitHub OIDC + IAM ロール
│   │   ├── main.tf                    #   OIDC プロバイダー、IAM ロール
│   │   ├── variables.tf
│   │   └── outputs.tf
│   │
│   └── codebuild/                     # Docker ビルド用 CodeBuild
│       ├── main.tf                    #   ARM64 ビルドプロジェクト
│       ├── variables.tf
│       └── outputs.tf
│
└── environments/
    └── prod/
        ├── main.tf                    # モジュール呼び出し・結合
        ├── variables.tf
        ├── terraform.tfvars           # 変数値（.gitignore 対象）
        └── backend.tf                 # local バックエンド設定
```

### `tests/` — テストコード

```
tests/
├── unit/                              # ユニットテスト
│   ├── lambdas/
│   │   ├── test_collector.py          #   collector 関数のテスト
│   │   ├── test_scorer.py             #   scorer 関数のテスト
│   │   ├── test_deliverer.py          #   deliverer 関数のテスト
│   │   ├── test_feedback.py           #   feedback 関数のテスト【Phase 2】
│   │   ├── test_weight_adjuster.py    #   weight_adjuster のテスト【Phase 2】
│   │   └── conftest.py                #   共通フィクスチャ（環境変数、モック、AWS_DEFAULT_REGION 等）
│   ├── shared/
│   │   ├── __init__.py
│   │   └── test_pipeline_runs.py      #   upsert_run_status のテスト（moto + 8件: extra attrs、retry 成功時 error クリア、別ステージ error 保持等）
│   └── summarizer/
│       ├── html-generator.test.js     #   HTML 生成のテスト
│       └── dashboard-generator.test.js #  ダッシュボード生成のテスト【Phase 3】
│
└── fixtures/                          # テスト用固定データ
    ├── hf_daily_papers.json           #   HF Daily Papers レスポンス例
    └── s2_batch_response.json         #   Semantic Scholar バッチレスポンス例
```

### `.github/` — CI/CD

```
.github/
└── workflows/
    ├── ci.yml                         # PR 時: lint, test, terraform plan
    └── deploy.yml                     # main マージ時: test, Lambda デプロイ, CodeBuild トリガー, S3 sync
```

### `docs/` — 永続的ドキュメント

```
docs/
├── product-requirements.md            # プロダクト要求定義書
├── functional-design.md               # 機能設計書
├── architecture.md                    # 技術仕様書
├── repository-structure.md            # リポジトリ構造定義書（本ファイル）
├── development-guidelines.md          # 開発ガイドライン
├── glossary.md                        # ユビキタス言語定義
└── secrets-setup.md                   # シークレット設定手順
```

### `static/` — S3 静的アセット

```
static/
├── style.css                          # 共通スタイルシート（モバイルレスポンシブ対応）
├── search.js                          # クライアントサイド検索（lunr.js + 日本語部分文字列検索）
└── auth/                              # Cognito OAuth (PKCE) フロー用静的ページ
    ├── login.html                     # PKCE code_verifier 生成、silent refresh、Hosted UI へ 302
    ├── callback.html                  # code → tokens 交換、Cookie 設定後 dest にリダイレクト
    ├── logout.html                    # Cookie 削除 + Cognito Logout エンドポイント
    ├── login.js / callback.js / logout.js
    ├── auth-helpers.js                # PKCE / Cookie / safeDest 共通ユーティリティ
    └── config.js                      # COGNITO_DOMAIN / CLIENT_ID / CLOUDFRONT_DOMAIN 注入用 (deploy.yml が sed)
```

## 3. ファイル配置ルール

### 言語・ランタイムの分離

| ディレクトリ | 言語 | ランタイム | 配置するもの |
|------------|------|-----------|------------|
| `src/lambdas/` | Python 3.12 | AWS Lambda | 各 Lambda 関数のハンドラ + ビジネスロジック |
| `src/summarizer/` | Node.js 22 | ECS Fargate | Claude CLI 要約生成 + HTML 生成 |
| `src/shared/` | Python | - | Lambda 間で共有する定数・ユーティリティ |
| `terraform/` | HCL | Terraform | インフラ定義のみ（アプリコードは含めない） |
| `tests/` | Python / JavaScript | pytest / node:test | テストコードのみ |
| `static/` | CSS / SVG | - | S3 にデプロイする静的アセット |

### Lambda 関数の構成ルール

各 Lambda 関数は `src/lambdas/{function_name}/` 配下に独立したディレクトリを持つ。

```
src/lambdas/{function_name}/
├── handler.py              # 必須: Lambda エントリポイント（handler 関数を定義）
├── {module}.py             # ビジネスロジックモジュール（複数可）
└── requirements.txt        # この関数固有の依存パッケージ
```

**ルール:**
- `handler.py` の `handler(event, context)` がエントリポイント
- 外部 API クライアントは `{service}_client.py` として分離
- 外部依存パッケージ（feedparser, requests）は `requirements.txt` に記載し、デプロイ時に zip に同梱
- `boto3` は Lambda ランタイム同梱のため `requirements.txt` に含めない

### Terraform モジュールの構成ルール

各モジュールは `terraform/modules/{module_name}/` 配下に配置。

```
terraform/modules/{module_name}/
├── main.tf                 # リソース定義
├── variables.tf            # 入力変数
└── outputs.tf              # 出力値
```

**ルール:**
- モジュールは AWS サービス単位で分割（dynamodb, lambda, ecs 等）
- `lambda` モジュールは共通モジュールとし、変数で関数ごとの差分を吸収
- 環境固有の値は `environments/prod/terraform.tfvars` に記載
- ハードコードされた値は使わず、すべて `variables.tf` で定義

## 4. 命名規則

### ファイル・ディレクトリ名

| 対象 | 規則 | 例 |
|------|------|-----|
| ディレクトリ | snake_case | `weight_adjuster/`, `s3-cloudfront/` |
| Python ファイル | snake_case | `arxiv_client.py`, `handler.py` |
| JavaScript ファイル | kebab-case | `claude-client.js`, `html-generator.js` |
| Terraform ファイル | 固定名 | `main.tf`, `variables.tf`, `outputs.tf` |
| テストファイル（Python） | `test_` プレフィックス | `test_collector.py` |
| テストファイル（JS） | `.test.js` サフィックス | `claude-client.test.js` |
| HTML テンプレート | kebab-case | `paper-detail.html` |

### AWS リソース名

| リソース | 命名規則 | 例 |
|---------|---------|-----|
| Lambda 関数 | `ai-papers-digest-{function}` | `ai-papers-digest-collector` |
| DynamoDB テーブル | `ai-papers-digest-{table}` | `ai-papers-digest-papers` |
| ECS クラスター | `ai-papers-digest` | - |
| ECS タスク定義 | `ai-papers-digest-{task}` | `ai-papers-digest-summarizer` |
| S3 バケット | `ai-papers-digest-{purpose}-{account_id}` | `ai-papers-digest-pages-123456789012` |
| CloudFront | 自動生成 | - |
| IAM ロール | `ai-papers-digest-{component}-role` | `ai-papers-digest-collector-role` |
| SQS DLQ | `ai-papers-digest-{function}-dlq` | `ai-papers-digest-collector-dlq` |
| CloudWatch ロググループ | `/aws/lambda/ai-papers-digest-{function}` | `/aws/lambda/ai-papers-digest-collector` |
| Secrets Manager | `ai-papers-digest/{secret}` | `ai-papers-digest/slack-webhook-url` |

## 5. `.gitignore`

```gitignore
# プロジェクト設定
.claude/
.devcontainer/
.gitattributes

# Claude Code
CLAUDE.md

# Terraform
terraform/**/placeholder.zip
terraform/**/*.tfvars
terraform/**/.terraform/
terraform/**/*.tfstate
terraform/**/*.tfstate.backup
terraform/**/.terraform.lock.hcl

# Python
__pycache__/
*.pyc
.venv/
*.egg-info/

# Node.js
node_modules/
dist/

# Lambda Layer ビルド成果物
src/lambdas/layer/python/

# IDE
.vscode/
.idea/

# OS
.DS_Store

# 環境変数・シークレット
.env
.env.*

# テスト
.coverage
htmlcov/
.pytest_cache/
```

## 6. Phase 別のディレクトリ有効範囲

凡例: `o` = 該当 Phase で導入 / 利用 / `-` = 未導入

| ディレクトリ / ファイル | P1 (収集〜配信) | P2 (FB学習) | P3 (Web ダッシュボード) | 認証 (2026-04-30) | 監視ダッシュボード (2026-04-30〜) |
|----------------------|:--:|:--:|:--:|:--:|:--:|
| `src/lambdas/collector/` | o | o | o | o | o |
| `src/lambdas/scorer/` | o | o | o | o | o |
| `src/lambdas/deliverer/` | o | o | o | o | o |
| `src/lambdas/feedback/` | - | o | o | o | o |
| `src/lambdas/weight_adjuster/` | - | o | o | o | o |
| `src/lambdas/token_refresher/` | - | - | o | o | o |
| `src/summarizer/` | o | o | o | o | o |
| `src/summarizer/src/embedding-client.js` | - | - | o | o | o |
| `src/summarizer/src/vectors-client.js` | - | - | o | o | o |
| `src/summarizer/src/dashboard-generator.js` | - | - | o | o | o |
| `src/summarizer/src/pipeline-runs.js` | - | - | - | - | o |
| `src/shared/pipeline_runs.py` | - | - | - | - | o |
| `terraform/modules/api-gateway/` | - | o | o | o | o |
| `terraform/modules/s3-vectors/` | - | - | o | o | o |
| `terraform/modules/github-oidc/` | - | - | o | o | o |
| `terraform/modules/codebuild/` | - | - | o | o | o |
| `terraform/modules/cognito/` | - | - | - | o | o |
| `terraform/modules/lambda-edge/` | - | - | - | o | o |
| `static/auth/` | - | - | - | o | o |
| `tests/unit/shared/` | - | - | - | - | o |
| `static/` (それ以外) | o | o | o | o | o |
