# 開発ガイドライン

## 1. コーディング規約

### Python（Lambda 関数）

| 項目 | 規約 |
|------|------|
| フォーマッター | Ruff（`ruff format`） |
| リンター | Ruff（`ruff check`） |
| 型チェック | mypy（`--strict` モード） |
| ドキュメント | Google スタイル docstring（公開関数のみ） |
| Python バージョン | 3.12 |
| インポート順序 | stdlib → third-party → local（Ruff が自動整理） |

**Ruff 設定（`pyproject.toml`）:**

```toml
[tool.ruff]
target-version = "py312"
line-length = 120

[tool.ruff.lint]
select = ["E", "F", "I", "N", "W", "UP", "B", "SIM"]

[tool.ruff.format]
quote-style = "double"
```

**mypy 設定（`pyproject.toml`）:**

```toml
[tool.mypy]
python_version = "3.12"
strict = true
warn_return_any = true
warn_unused_configs = true
```

### JavaScript / Node.js（Fargate summarizer）

| 項目 | 規約 |
|------|------|
| フォーマッター | Prettier |
| リンター | ESLint（flat config） |
| 型チェック | なし（純粋 JavaScript） |
| モジュール | CommonJS（`require`）※ Claude CLI との互換性のため |
| Node.js バージョン | 22 LTS |

**Prettier 設定（`.prettierrc`）:**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### Terraform（HCL）

| 項目 | 規約 |
|------|------|
| フォーマッター | `terraform fmt` |
| リンター | `tflint` |
| 命名規則 | snake_case（リソース名、変数名） |
| モジュール呼び出し | `source = "../modules/{name}"` で相対パス |

## 2. 命名規則

### Python

| 対象 | 規則 | 例 |
|------|------|-----|
| ファイル名 | snake_case | `arxiv_client.py` |
| 関数 | snake_case | `fetch_daily_papers()` |
| クラス | PascalCase | `PaperMerger` |
| 定数 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT` |
| 変数 | snake_case | `paper_list` |
| プライベート | `_` プレフィックス | `_normalize_score()` |

### JavaScript

| 対象 | 規則 | 例 |
|------|------|-----|
| ファイル名 | kebab-case | `claude-client.js` |
| 関数 | camelCase | `generateSummary()` |
| クラス | PascalCase | `HtmlGenerator` |
| 定数 | UPPER_SNAKE_CASE | `CLAUDE_TIMEOUT_MS` |
| 変数 | camelCase | `paperData` |

### Terraform

| 対象 | 規則 | 例 |
|------|------|-----|
| リソース名 | snake_case | `aws_lambda_function.collector` |
| 変数名 | snake_case | `papers_table_name` |
| モジュール名 | kebab-case（ディレクトリ） | `s3-cloudfront/` |
| 出力名 | snake_case | `collector_function_arn` |

### AWS リソース命名

プロジェクトプレフィックス: **`ai-papers-digest`**

```
{prefix}-{component}[-{suffix}]
```

| リソース | パターン | 例 |
|---------|---------|-----|
| Lambda | `{prefix}-{function}` | `ai-papers-digest-collector` |
| DynamoDB | `{prefix}-{table}` | `ai-papers-digest-papers` |
| S3 | `{prefix}-{purpose}-{account_id}` | `ai-papers-digest-pages-123456789012` |
| IAM ロール | `{prefix}-{component}-role` | `ai-papers-digest-collector-role` |
| SQS DLQ | `{prefix}-{function}-dlq` | `ai-papers-digest-collector-dlq` |
| Secrets Manager | `{prefix}/{secret}` | `ai-papers-digest/slack-webhook-url` |

## 3. スタイリング規約（S3 詳細ページ）

| 項目 | 規約 |
|------|------|
| CSS | Vanilla CSS（フレームワークなし） |
| レスポンシブ | モバイルファースト（Slack からの遷移を想定） |
| フォント | システムフォント（`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`） |
| カラー | ライトテーマのみ（シンプルさ優先） |

CSS 変数で統一:

```css
:root {
  --color-primary: #1a73e8;
  --color-text: #202124;
  --color-text-secondary: #5f6368;
  --color-bg: #ffffff;
  --color-border: #dadce0;
  --color-tag-bg: #e8f0fe;
  --max-width: 800px;
}
```

## 4. テスト規約

### テストフレームワーク

| 言語 | フレームワーク | カバレッジツール |
|------|-------------|---------------|
| Python | pytest | pytest-cov |
| JavaScript | Jest | Jest built-in |

### テスト分類

| 種別 | 配置先 | 実行タイミング | 対象 |
|------|--------|--------------|------|
| ユニットテスト | `tests/unit/` | PR 時・main マージ時 | 個別関数のロジック |
| 統合テスト | `tests/integration/` | main マージ時 | パイプライン E2E |

### ユニットテスト方針

- **外部 API はモック化**: `unittest.mock` / Jest `jest.mock()` で外部依存を分離
- **DynamoDB はモック化**: `moto`（Python）で DynamoDB をローカルモック
- **Claude CLI はモック化**: `execSync` をモックし、固定 JSON レスポンスを返す
- **テストデータ**: `tests/fixtures/` に JSON/XML のサンプルレスポンスを配置

### カバレッジ目標

| 対象 | 目標 |
|------|------|
| ビジネスロジック（scoring, filter, merger） | 80% 以上 |
| API クライアント | 60% 以上（正常系 + エラー系） |
| ハンドラ（handler.py） | 50% 以上 |

### pytest 設定（`pyproject.toml`）:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
addopts = "-v --cov=src/lambdas --cov-report=term-missing"
```

## 5. Git 規約

### ブランチ戦略

| ブランチ | 用途 | マージ先 |
|---------|------|---------|
| `main` | 本番デプロイ対象 | - |
| `feature/{description}` | 機能開発 | main |
| `fix/{description}` | バグ修正 | main |
| `chore/{description}` | 設定・ドキュメント変更 | main |

**ルール:**
- `main` への直接プッシュは禁止（PR 必須）
- PR は squash merge で統合
- ブランチは マージ後に削除

### コミットメッセージ

Conventional Commits 形式:

```
{type}: {description}

{body}（任意）
```

| type | 用途 |
|------|------|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `refactor` | リファクタリング |
| `docs` | ドキュメント |
| `test` | テスト |
| `chore` | ビルド・設定変更 |
| `infra` | Terraform / インフラ変更 |

**例:**
```
feat: add Hugging Face Daily Papers collector

infra: add DynamoDB tables with PITR for summaries and feedback

fix: handle arXiv API timeout gracefully
```

### PR ルール

| 項目 | 規約 |
|------|------|
| タイトル | Conventional Commits 形式（70文字以内） |
| 本文 | Summary + Test Plan |
| レビュー | セルフレビュー（個人プロジェクト） |
| CI | lint + test + terraform plan が pass |
| マージ方法 | Squash and merge |

## 6. 環境変数管理

### ローカル開発

`.env` ファイル（`.gitignore` 対象）に記載:

```env
# AWS
AWS_PROFILE=ai-papers-digest
AWS_REGION=ap-northeast-1

# テスト用
PAPERS_TABLE=ai-papers-digest-papers-dev
SUMMARIES_TABLE=ai-papers-digest-summaries-dev
```

### Lambda 環境変数

Terraform の `environment` ブロックで設定。シークレットは Secrets Manager の ARN を参照:

```hcl
environment {
  variables = {
    PAPERS_TABLE          = var.papers_table_name
    S2_API_KEY_SECRET_ARN = var.s2_api_key_secret_arn  # 値ではなくARNを渡す
    LOG_LEVEL             = "INFO"
  }
}
```

**ルール:**
- シークレット値を環境変数に直接設定しない
- Secrets Manager の ARN を渡し、ランタイムで取得する
- `LOG_LEVEL` で出力レベルを制御可能にする

## 7. デプロイ手順

### 初回セットアップ

```bash
# 1. Terraform バックエンド用リソースを手動作成（1回のみ）
aws s3 mb s3://ai-papers-digest-tfstate-${AWS_ACCOUNT_ID} --region ap-northeast-1
aws s3api put-bucket-versioning --bucket ai-papers-digest-tfstate-${AWS_ACCOUNT_ID} --versioning-configuration Status=Enabled
aws dynamodb create-table --table-name ai-papers-digest-tflock --attribute-definitions AttributeName=LockID,AttributeType=S --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST --region ap-northeast-1

# 2. Terraform 初期化・適用
cd terraform/environments/prod
terraform init
terraform plan
terraform apply

# 3. Docker イメージのビルド・プッシュ
cd src/summarizer
docker build -t ai-papers-digest-summarizer .
# ECR にプッシュ（terraform output で ECR URI を取得）

# 4. Secrets Manager にシークレットを手動登録
aws secretsmanager create-secret --name ai-papers-digest/slack-webhook-url --secret-string "https://hooks.slack.com/..."
aws secretsmanager create-secret --name ai-papers-digest/semantic-scholar-api-key --secret-string "..."
aws secretsmanager create-secret --name ai-papers-digest/claude-auth-token --secret-string "..."
```

### 日常デプロイ（CI/CD 経由）

1. feature ブランチで開発
2. PR 作成 → CI（lint, test, terraform plan）
3. レビュー・承認
4. Squash merge → CD（test, ECR push, terraform apply, smoke test）

## 8. ローカル開発環境

### 前提ツール

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Python | 3.12 | Lambda 関数開発 |
| Node.js | 22 LTS | summarizer 開発 |
| Terraform | >= 1.9 | IaC |
| AWS CLI | v2 | AWS リソース操作 |
| Docker | latest | Fargate コンテナビルド |
| Ruff | latest | Python lint / format |
| pytest | latest | Python テスト |

### セットアップ

```bash
# Python 仮想環境
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r src/lambdas/layer/requirements.txt
pip install -r requirements-dev.txt  # pytest, mypy, ruff 等

# Node.js
cd src/summarizer
npm install

# テスト実行
pytest                      # Python ユニットテスト
cd src/summarizer && npm test  # JS ユニットテスト
```

### `requirements-dev.txt`（開発用依存）

```
pytest
pytest-cov
moto[dynamodb]
mypy
ruff
boto3-stubs[dynamodb,lambda,ecs,s3,secretsmanager]
```

## 9. セキュリティスキャン規約

### スキャンツール

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Trivy | v0.69.3（安全バージョン） | Terraform IaC misconfiguration スキャン |

> **注意:** Trivy v0.69.4〜v0.69.6 はサプライチェーン攻撃（CVE-2026-33634）の対象。
> 必ず v0.69.3 以前を使用し、SHA ピン留めでバージョンを固定すること。

### スキャン実行タイミング

| タイミング | コマンド | 対象 |
|-----------|---------|------|
| Terraform 変更時（手動） | `trivy config terraform/ --severity HIGH,CRITICAL` | 全 .tf ファイル |
| PR レビュー時 | 上記を手動で確認 | 変更のある Terraform モジュール |

### 指摘への対応基準

| 深刻度 | 対応方針 |
|--------|---------|
| CRITICAL | 原則すべて修正。許容する場合はアーキテクチャ設計書（§12）に理由を明記 |
| HIGH | 修正を推奨。コスト・設計上の理由で許容する場合は理由を明記 |
| MEDIUM | 個別判断。個人利用の場合はコスト対効果で許容可 |
| LOW | 対応任意 |

### シークレット管理ルール

- **禁止:** `.tf` ファイル、環境変数、ソースコードへのシークレット値の直接記述
- **必須:** AWS Secrets Manager の ARN を経由して値をランタイムで取得
- **必須:** `terraform.tfvars` は `.gitignore` に含め、Git 管理外とする
- **確認:** `trivy config` でシークレットのハードコードが検出されないことを確認
