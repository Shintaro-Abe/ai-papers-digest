# シークレットセットアップガイド

構築前に用意すべき API キー・シークレットの一覧と入手方法。

## 1. シークレット一覧

| # | シークレット | Secrets Manager 名 | 用途 | Phase |
|---|------------|-------------------|------|:-----:|
| 1 | Slack Incoming Webhook URL | `ai-papers-digest/slack-webhook-url` | Slack チャンネルへの要約配信 | 1 |
| 2 | Semantic Scholar API Key | `ai-papers-digest/semantic-scholar-api-key` | 論文の引用数・TLDR 取得 | 1 |
| 3 | Claude Max 認証トークン | `ai-papers-digest/claude-auth-token` | Fargate で `claude -p` CLI を実行 | 1 |
| 4 | Slack Signing Secret | `ai-papers-digest/slack-signing-secret` | Slack リアクション署名検証 | 2 |
| 5 | Slack Bot Token | `ai-papers-digest/slack-bot-token` | chat.postMessage + リアクション取得 | 2 |
| 6 | Slack チャンネル ID | 環境変数 `SLACK_CHANNEL_ID` | 投稿先チャンネル指定 | 2 |

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

### 2.4 Phase 2: Slack App 設定変更

Phase 2 では Slack 配信方式を Incoming Webhook から Bot Token + `chat.postMessage` に移行し、リアクション（👍/👎）によるフィードバック収集を追加する。以下の手順で Slack App を設定変更する。

#### 2.4.1 Bot Token Scopes の追加

1. https://api.slack.com/apps で `AI Papers Digest` App を開く
2. 左メニュー「OAuth & Permissions」をクリック
3. 「Scopes」セクションの「Bot Token Scopes」に以下を追加:
   - `chat:write` — メッセージ投稿
   - `channels:history` — チャンネルのメッセージ履歴参照
   - `reactions:read` — リアクション情報の読み取り
4. ページ上部の「Reinstall to Workspace」をクリック（Scopes 変更後は再インストールが必要）
5. 権限を確認して「許可する」をクリック

#### 2.4.2 Bot User OAuth Token の取得

**形式:** `xoxb-` で始まるトークン文字列

1. 「OAuth & Permissions」ページの上部「OAuth Tokens for Your Workspace」セクション
2. 「Bot User OAuth Token」の値をコピー（`xoxb-...` 形式）

#### 2.4.3 Signing Secret の取得

**形式:** 32文字の16進数文字列

1. 左メニュー「Basic Information」をクリック
2. 「App Credentials」セクション
3. 「Signing Secret」の「Show」をクリック
4. 表示された値をコピー

#### 2.4.4 Event Subscriptions の有効化【API Gateway 構築後に実施】

> **この手順は Terraform で API Gateway + feedback Lambda をデプロイした後に実施する。**
> API Gateway のエンドポイント URL が必要なため、事前には設定できない。
> Phase 2 tasklist の Step 4.6 で実施する。

1. 左メニュー「Event Subscriptions」をクリック
2. 「Enable Events」を ON にする
3. 「Request URL」に API Gateway のエンドポイント URL を入力:
   ```
   https://{api-gateway-id}.execute-api.ap-northeast-1.amazonaws.com/slack/events
   ```
   URL を入力すると Slack が URL Verification Challenge を自動送信する。
   feedback Lambda が正しく `challenge` を返すと「Verified」と表示される。
4. 「Subscribe to bot events」セクションで以下を追加:
   - `reaction_added` — リアクション追加イベント
   - `reaction_removed` — リアクション削除イベント
5. 「Save Changes」をクリック

#### 2.4.5 チャンネル ID の取得

**形式:** `C` で始まる英数字文字列（例: `C0XXXXXXX`）

1. Slack デスクトップアプリまたは Web で `#ai-papers-digest` チャンネルを開く
2. チャンネル名をクリック → チャンネル詳細画面を開く
3. 最下部にある「チャンネル ID」をコピー

または Slack API で取得:
```bash
curl -s -H "Authorization: Bearer xoxb-YOUR-BOT-TOKEN" \
  "https://slack.com/api/conversations.list?types=public_channel&limit=100" \
  | python3 -c "import sys,json; channels=json.load(sys.stdin)['channels']; [print(f'{c[\"id\"]}: {c[\"name\"]}') for c in channels if 'papers' in c['name']]"
```

#### 2.4.6 Bot をチャンネルに招待

Bot Token で投稿するには、Bot がチャンネルのメンバーである必要がある。

1. `#ai-papers-digest` チャンネルで以下を入力:
   ```
   /invite @AI Papers Digest
   ```
2. Bot がチャンネルに参加したことを確認

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

### Phase 2 追加分

```bash
# 4. Slack Signing Secret
aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/slack-signing-secret \
  --secret-string "your-signing-secret-here" \
  --region ap-northeast-1

# 5. Slack Bot Token
aws secretsmanager put-secret-value \
  --secret-id ai-papers-digest/slack-bot-token \
  --secret-string "xoxb-your-bot-token-here" \
  --region ap-northeast-1
```

> チャンネル ID はシークレットではないため、Terraform の変数（`SLACK_CHANNEL_ID`）として Lambda 環境変数に設定する。

### 登録確認コマンド

```bash
# 値が登録されていることを確認（値の先頭10文字のみ表示）
for secret in slack-webhook-url semantic-scholar-api-key claude-auth-token slack-signing-secret slack-bot-token; do
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
| Slack Signing Secret | Phase 2 Step 3.6（terraform apply 後） | フィードバック Lambda の署名検証に必要 |
| Slack Bot Token | Phase 2 Step 2.5（deliverer 移行テスト） | chat.postMessage での投稿に必要 |
| Slack チャンネル ID | Phase 2 Step 2.4（Terraform 変数） | シークレットではなく環境変数で設定 |

### 推奨手順

**Phase 1:** `terraform apply` 完了直後に 3件をまとめて登録する。
**Phase 2:** `terraform apply` 完了直後に 2件（Bot Token + Signing Secret）を登録する。

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
