# Phase 2: フィードバック収集 + 学習ループ 実装設計

## 1. 実装アプローチ

### 実装順序

Phase 1 の deliverer 移行を最初に行い、フィードバック収集の基盤を整えてから学習ループを追加する。

```
Step 1: Slack App 設定変更 + Secrets Manager 登録
Step 2: deliverer Lambda を chat.postMessage に移行（ts 取得対応）
Step 3: Terraform: API Gateway + feedback Lambda + 週次 EventBridge
Step 4: Lambda feedback（リアクション収集）実装
Step 5: Lambda weight-adjuster（ウェイト再計算）実装
Step 6: scorer の feedback_bonus 有効化
Step 7: E2E テスト
```

## 2. 変更するコンポーネント

### 新規作成

```
src/lambdas/feedback/
├── handler.py              # Slack Events API ハンドラ
├── slack_verifier.py       # Slack 署名検証
├── reaction_parser.py      # リアクションイベント解析
└── requirements.txt

src/lambdas/weight_adjuster/
├── handler.py              # ウェイト再計算ハンドラ
├── weight_optimizer.py     # ウェイト最適化ロジック
└── requirements.txt

terraform/modules/api-gateway/
├── main.tf
├── variables.tf
└── outputs.tf
```

### 変更

```
src/lambdas/deliverer/
├── handler.py              # Webhook → chat.postMessage 移行
└── slack_client.py         # Bot Token 対応

src/lambdas/scorer/
└── handler.py              # feedback_bonus 有効化

terraform/environments/prod/
├── main.tf                 # API Gateway, feedback, weight-adjuster 追加
└── variables.tf            # 新変数追加
```

## 3. 各コンポーネントの実装設計

### 3.1 Slack App 設定変更（Step 1）

**追加する Bot Token Scopes:**
- `chat:write` — メッセージ投稿
- `channels:history` — チャンネルのメッセージ履歴参照
- `reactions:read` — リアクション情報の読み取り

**追加する Event Subscriptions:**
- `reaction_added` — リアクション追加イベント
- `reaction_removed` — リアクション削除イベント

**Secrets Manager に追加するシークレット:**

| シークレット名 | 内容 | 登録タイミング |
|---------------|------|-------------|
| `ai-papers-digest/slack-bot-token` | Bot User OAuth Token（`xoxb-...`） | Slack App 設定後 |
| `ai-papers-digest/slack-signing-secret` | Signing Secret（Phase 1 で箱は作成済み） | Slack App 設定画面から取得 |

### 3.2 deliverer Lambda 移行（Step 2）

**変更点:** Incoming Webhook → `chat.postMessage` API

**slack_client.py の変更:**

```python
# 変更前: Incoming Webhook
def post_message(webhook_url, message):
    requests.post(webhook_url, json=message)

# 変更後: Bot Token + chat.postMessage
def post_message(bot_token, channel_id, blocks):
    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={"Authorization": f"Bearer {bot_token}"},
        json={"channel": channel_id, "blocks": blocks},
    )
    data = resp.json()
    return data.get("ts")  # メッセージ ts を返す
```

**delivery_log への ts 保存:**

```python
# 各メッセージ投稿後に ts を delivery_log に記録
table.update_item(
    Key={"date": date, "arxiv_id": arxiv_id},
    UpdateExpression="SET slack_message_ts = :ts",
    ExpressionAttributeValues={":ts": message_ts},
)
```

**環境変数の変更:**

| 変更前 | 変更後 |
|--------|--------|
| `SLACK_WEBHOOK_SECRET_ARN` | `SLACK_BOT_TOKEN_SECRET_ARN` |
| （なし） | `SLACK_CHANNEL_ID` |

### 3.3 API Gateway + feedback Lambda（Step 3-4）

**API Gateway HTTP API 構成:**

```
POST /slack/events → feedback Lambda
```

| 設定 | 値 |
|------|-----|
| タイプ | HTTP API（v2） |
| ルート | `POST /slack/events` |
| 統合 | Lambda プロキシ |
| スロットリング | 10 req/sec, バースト 20 |
| アクセスログ | CloudWatch Logs 有効 |

**feedback Lambda のフロー:**

```python
def handler(event, context):
    body = json.loads(event["body"])

    # 1. Slack URL Verification Challenge（初回設定時のみ）
    if body.get("type") == "url_verification":
        return {"statusCode": 200, "body": body["challenge"]}

    # 2. Slack 署名検証
    if not slack_verifier.verify(event["headers"], event["body"]):
        return {"statusCode": 401, "body": "Invalid signature"}

    # 3. イベント処理
    slack_event = body.get("event", {})
    event_type = slack_event.get("type")

    if event_type == "reaction_added":
        reaction = slack_event["reaction"]
        if reaction in ("+1", "-1", "thumbsup", "thumbsdown"):
            # メッセージ ts → arxiv_id を特定
            message_ts = slack_event["item"]["ts"]
            arxiv_id = _lookup_arxiv_id(message_ts)
            if arxiv_id:
                _save_feedback(
                    user_id=slack_event["user"],
                    arxiv_id=arxiv_id,
                    reaction="like" if reaction in ("+1", "thumbsup") else "dislike",
                    message_ts=message_ts,
                )

    elif event_type == "reaction_removed":
        message_ts = slack_event["item"]["ts"]
        arxiv_id = _lookup_arxiv_id(message_ts)
        if arxiv_id:
            _delete_feedback(
                user_id=slack_event["user"],
                arxiv_id=arxiv_id,
            )

    return {"statusCode": 200, "body": "ok"}
```

**Slack 署名検証（slack_verifier.py）:**

```python
import hashlib
import hmac
import time

def verify(headers, body, signing_secret):
    timestamp = headers.get("x-slack-request-timestamp", "")
    signature = headers.get("x-slack-signature", "")

    # リプレイ攻撃防止: 5分以上古いリクエストは拒否
    if abs(time.time() - int(timestamp)) > 300:
        return False

    sig_basestring = f"v0:{timestamp}:{body}"
    expected = "v0=" + hmac.new(
        signing_secret.encode(),
        sig_basestring.encode(),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(expected, signature)
```

**message_ts → arxiv_id のルックアップ:**

```python
def _lookup_arxiv_id(message_ts):
    # delivery_log テーブルを scan して slack_message_ts が一致するアイテムを検索
    # GSI (slack_message_ts) があると高速だが、低頻度なので scan で十分
    resp = table.scan(
        FilterExpression="slack_message_ts = :ts",
        ExpressionAttributeValues={":ts": message_ts},
    )
    items = resp.get("Items", [])
    return items[0]["arxiv_id"] if items else None
```

### 3.4 weight-adjuster Lambda（Step 5）

**ウェイト再計算ロジック:**

```python
def optimize_weights(feedback_data, papers_data):
    """
    各スコアリング要素の「予測力」を評価し、ウェイトを調整する。

    予測力 = Like された論文のスコア要素の平均値 / 全論文のスコア要素の平均値
    予測力が高い → その要素は Like を予測する力がある → ウェイトを上げる
    """
    liked_papers = {f["arxiv_id"] for f in feedback_data if f["reaction"] == "like"}
    disliked_papers = {f["arxiv_id"] for f in feedback_data if f["reaction"] == "dislike"}

    if not liked_papers:
        return None  # フィードバック不足、ウェイト変更なし

    elements = ["hf_upvotes", "s2_citation_count", "source_count"]
    predictive_power = {}

    for elem in elements:
        all_mean = mean([p.get(elem, 0) for p in papers_data])
        liked_mean = mean([p.get(elem, 0) for p in papers_data if p["arxiv_id"] in liked_papers])

        if all_mean > 0:
            predictive_power[elem] = liked_mean / all_mean
        else:
            predictive_power[elem] = 1.0

    # 正規化して合計 0.8（w4=0.2 は feedback_bonus 用に固定）
    total = sum(predictive_power.values())
    weights = {
        "w1": max(0.05, predictive_power["hf_upvotes"] / total * 0.8),
        "w2": max(0.05, predictive_power["s2_citation_count"] / total * 0.8),
        "w3": max(0.05, predictive_power["source_count"] / total * 0.8),
        "w4": 0.2,
    }

    # 合計 1.0 に再正規化
    w_total = sum(weights.values())
    weights = {k: round(v / w_total, 4) for k, v in weights.items()}

    return weights
```

### 3.5 scorer の feedback_bonus 有効化（Step 6）

**scoring.py の変更:**

```python
# 変更前
+ w4 * 0.0  # feedback_bonus: Phase 2

# 変更後
+ w4 * calculate_feedback_bonus(paper, feedback_data)

def calculate_feedback_bonus(paper, feedback_data):
    """
    過去に Like された論文との類似度に基づくボーナススコア。
    Phase 2 では簡易版: 同カテゴリの Like 率をボーナスとする。
    """
    paper_categories = set(paper.get("categories", []))
    if not paper_categories or not feedback_data:
        return 0.0

    liked_categories = Counter()
    total_categories = Counter()
    for f in feedback_data:
        cats = set(f.get("categories", []))
        total_categories.update(cats)
        if f["reaction"] == "like":
            liked_categories.update(cats)

    # 論文のカテゴリの平均 Like 率
    rates = []
    for cat in paper_categories:
        if total_categories[cat] > 0:
            rates.append(liked_categories[cat] / total_categories[cat])

    return sum(rates) / len(rates) if rates else 0.0
```

## 4. データ構造の変更

### 変更なし（Phase 1 で定義済み）

- `feedback` テーブル: PK=user_id, SK=arxiv_id（Phase 1 で作成済み、未使用だったものを実運用開始）
- `delivery_log` テーブル: `slack_message_ts` 属性を追加使用

### Secrets Manager 追加

| シークレット名 | 内容 |
|---------------|------|
| `ai-papers-digest/slack-bot-token` | 新規作成。Bot User OAuth Token |

## 5. 影響範囲の分析

| コンポーネント | 影響 | リスク |
|--------------|------|--------|
| deliverer Lambda | Webhook → Bot Token 移行。配信ロジック変更 | Slack 配信の一時停止リスク。Webhook を残してフォールバック可能にする |
| scorer Lambda | feedback_bonus 計算追加 | フィードバック不足時は 0.0 を返すので影響なし |
| DynamoDB delivery_log | slack_message_ts 属性追加 | 既存アイテムには属性なし。フィードバック対象外になるだけで問題なし |
| Slack App | Scopes 追加、Events API 追加 | App の再インストールが必要（ワークスペースの権限更新） |

## 6. リスクと軽減策

| リスク | 影響 | 軽減策 |
|--------|------|--------|
| deliverer 移行で Slack 配信が壊れる | 日次配信が停止 | Webhook URL は削除せず残す。Bot Token 失敗時に Webhook にフォールバック |
| Slack Events API の URL Verification が失敗 | フィードバック収集不可 | API Gateway デプロイ後に手動で URL Verification を実行・確認 |
| フィードバックデータ不足でウェイトが偏る | スコアリング精度低下 | 最小ウェイト 0.05 を設定。Like 件数が 10 件未満ならウェイト更新をスキップ |
| API Gateway への不正アクセス | Lambda の不要な実行 | Slack 署名検証 + スロットリング（10 req/sec） |
