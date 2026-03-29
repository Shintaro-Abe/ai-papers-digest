# シークレットセットアップガイド

Phase 1 の構築前に用意すべき API キー・シークレットの一覧と入手方法。

## 1. シークレット一覧

| # | シークレット | Secrets Manager 名 | 用途 | Phase |
|---|------------|-------------------|------|:-----:|
| 1 | Slack Incoming Webhook URL | `ai-papers-digest/slack-webhook-url` | Slack チャンネルへの要約配信 | 1 |
| 2 | Semantic Scholar API Key | `ai-papers-digest/semantic-scholar-api-key` | 論文の引用数・TLDR 取得 | 1 |
| 3 | Claude Max 認証トークン | `ai-papers-digest/claude-auth-token` | Fargate で `claude -p` CLI を実行 | 1 |
| 4 | Slack Signing Secret | `ai-papers-digest/slack-signing-secret` | Slack リアクション署名検証 | 2 |

## 2. 入手手順

### 2.1 Slack Incoming Webhook URL

**形式:** Slack App の Incoming Webhook 設定画面に表示される URL

1. https://api.slack.com/apps にアクセス
2. 「Create New App」→「From scratch」を選択
3. App Name: `AI Papers Digest`、Workspace: 自分のワークスペースを選択
4. 左メニュー「Incoming Webhooks」→「Activate Incoming Webhooks」を ON
5. 「Add New Webhook to Workspace」をクリック
6. 投稿先チャンネル `#ai-papers-digest` を選択（事前にチャンネルを作成しておく）
7. 表示される Webhook URL をコピー

> **Phase 2 準備（任意）:** 同じ Slack App で以下も設定しておくと Phase 2 移行がスムーズ
> - 「OAuth & Permissions」→ Bot Token Scopes に `channels:history`, `reactions:read` を追加
> - 「Event Subscriptions」を有効化（Request URL は Phase 2 で API Gateway 構築後に設定）

### 2.2 Semantic Scholar API Key

**形式:** 40文字程度の英数字文字列

1. https://www.semanticscholar.org/product/api#api-key-form にアクセス
2. 「Request API Key」フォームに入力:
   - **Name:** 自分の名前
   - **Email:** メールアドレス
   - **Organization:** 所属（個人なら "Personal"）
   - **Use case:** "Academic paper discovery and summarization"
3. フォーム送信後、メールで API Key が届く（通常数分〜数時間）
4. 届いた API Key をコピー

**レート制限:** 認証済みで 1 リクエスト/秒（未認証より大幅に緩和）

### 2.3 Claude Max 認証トークン

**形式:** OAuth アクセストークン文字列

**前提:** Claude Max プラン（Max 5x: $100/月 または Max 20x: $200/月）に加入済みであること

1. ローカル PC に Claude Code CLI をインストール:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. CLI を起動してブラウザ認証:
   ```bash
   claude
   ```
3. ブラウザが開き、Anthropic アカウントでログイン
4. 認証完了後、以下のパスから認証情報を確認:
   ```bash
   cat ~/.claude/credentials.json
   # または
   cat ~/.claude/.credentials.json
   ```
5. JSON 内の `accessToken`（または `oauthToken`）フィールドの値をコピー

**注意事項:**
- トークンの有効期限・リフレッシュ仕様は Anthropic 公式ドキュメントで要確認
- 有効期限切れ時は再度 `claude` コマンドでブラウザ認証が必要
- Fargate タスクでトークンが期限切れになった場合、要約生成が失敗する → CloudWatch Alarm で検知

### 2.4 Slack Signing Secret【Phase 2】

**形式:** 32文字の16進数文字列

1. https://api.slack.com/apps で作成済みの `AI Papers Digest` App を開く
2. 「Basic Information」→「App Credentials」セクション
3. 「Signing Secret」の「Show」をクリック
4. 表示された値をコピー

> Phase 1 では不要。Phase 2（フィードバック収集）実装時に登録する。

## 3. Secrets Manager への登録

### 前提

`terraform apply` により、シークレットの「箱」（空の Secret リソース）が作成済みであること。

### 登録コマンド

```bash
# 1. Slack Webhook URL
aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/slack-webhook-url \
  --secret-string "<Slack Webhook URL>" \
  --region ap-northeast-1

# 2. Semantic Scholar API Key
aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/semantic-scholar-api-key \
  --secret-string "your-s2-api-key-here" \
  --region ap-northeast-1

# 3. Claude Auth Token
aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/claude-auth-token \
  --secret-string "your-claude-oauth-token-here" \
  --region ap-northeast-1
```

### 登録確認コマンド

```bash
# 値が登録されていることを確認（値の先頭10文字のみ表示）
for secret in slack-webhook-url semantic-scholar-api-key claude-auth-token; do
  echo -n "ai-papers-digest/$secret: "
  aws secretsmanager get-secret-value \
    --secret-id "ai-papers-digest/$secret" \
    --query 'SecretString' --output text \
    --region ap-northeast-1 | cut -c1-10
  echo "..."
done
```

## 4. 登録タイミング

### 実装フローとの関係

```
Step 1.12  terraform apply          ← Secrets Manager の「箱」が作成される
                ↓
         シークレット値を登録        ← ★ ここで 3件すべて登録（推奨）
                ↓
Step 2.9   collector 動作確認       ← Semantic Scholar API Key を使用
Step 4.1   Claude CLI 動作検証      ← Claude Auth Token を使用
Step 5.5   deliverer 動作確認       ← Slack Webhook URL を使用
Step 6.3   E2E パイプラインテスト    ← 全シークレットを使用
```

### 各シークレットが必要になる最初のタイミング

| シークレット | 最初に必要な Step | 理由 |
|------------|-----------------|------|
| Semantic Scholar API Key | Step 2.9（collector 動作確認） | 外部 API 呼び出しで API Key が必要 |
| Claude Auth Token | Step 4.1（Claude CLI 動作検証） | Fargate で `claude -p` を実行するため |
| Slack Webhook URL | Step 5.5（deliverer 動作確認） | Slack チャンネルへの投稿テスト |
| Slack Signing Secret | Phase 2 開始時 | Phase 1 では不要 |

### 推奨手順

**`terraform apply`（Step 1.12）完了直後に Phase 1 の 3件をまとめて登録する。**

各 Step の動作確認で都度つまずかずに済み、最もシンプル。

```bash
# terraform apply 完了直後に実行
aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/semantic-scholar-api-key \
  --secret-string "your-s2-api-key" --region ap-northeast-1

aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/claude-auth-token \
  --secret-string "your-claude-token" --region ap-northeast-1

aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/slack-webhook-url \
  --secret-string "<Slack Webhook URL>" --region ap-northeast-1
```

## 5. セキュリティ注意事項

- シークレットの値をソースコード、コミットメッセージ、PR 本文に記載しない
- `terraform.tfvars` には Secrets Manager の **ARN のみ** を記載（値は含めない）
- ローカルの `.env` ファイルにシークレットを記載する場合は `.gitignore` 対象であることを確認
- シークレットの共有はパスワードマネージャーまたは暗号化されたチャネルで行う
