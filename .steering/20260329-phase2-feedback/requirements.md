# Phase 2: フィードバック収集 + 学習ループ 要求内容

## 1. 概要

Phase 2 として、Slack リアクションによるフィードバック収集と、評価データに基づくスコアリングウェイトの動的調整機能を追加する。

## 2. スコープ

### 対象機能（PRD F8〜F9）

| # | 機能 | 概要 |
|---|------|------|
| F8 | フィードバック収集 | Slack リアクション（👍/👎）でユーザー評価を収集 |
| F9 | フィードバック学習 | 評価データに基づくスコアリングウェイトの動的調整 |

### Phase 1 からの変更点

| コンポーネント | 変更内容 |
|--------------|---------|
| Slack App | Incoming Webhook → **Bot Token + chat.postMessage** に移行（メッセージ ts 取得のため） |
| 新規: API Gateway | Slack Events API のエンドポイント（HTTP API v2） |
| 新規: Lambda feedback | リアクションイベント受信 → DynamoDB 保存 |
| 新規: Lambda weight-adjuster | 週次でスコアリングウェイトを再計算 |
| 既存: Lambda deliverer | Incoming Webhook → Bot Token + chat.postMessage に変更 |
| 既存: Lambda scorer | feedback_bonus を計算に組み込み（w4 が有効化） |
| 既存: DynamoDB | feedback テーブルを実運用開始 |
| 既存: EventBridge | 週次スケジュール追加（weight-adjuster 用） |

### スコープ外

- Web ダッシュボード（Phase 3）
- セマンティック検索（Phase 3）
- ユーザーごとのパーソナライズ（Phase 2 では全ユーザー集約の嗜好プロファイル）

## 3. ユーザーストーリー

### US3: 要約を評価する
- Slack メッセージに 👍/👎 リアクションで評価できる
- 評価結果が DynamoDB に保存される
- 評価データが次回以降のスコアリングに反映される

## 4. 受け入れ条件

### AC1: Slack 配信の移行（Incoming Webhook → Bot Token）
- [ ] Slack App に Bot Token Scopes（`chat:write`, `channels:history`, `reactions:read`）を追加
- [ ] deliverer Lambda が `chat.postMessage` API で投稿する
- [ ] 各メッセージの `ts`（タイムスタンプ）が delivery_log に保存される
- [ ] 既存の Slack 配信機能が引き続き正常動作する

### AC2: フィードバック収集
- [ ] API Gateway HTTP API エンドポイントが作成される
- [ ] Slack Events API（`reaction_added`, `reaction_removed`）がエンドポイントに接続される
- [ ] Slack 署名検証（Signing Secret）がアプリ層で実施される
- [ ] 👍 リアクション → `{user_id, arxiv_id, reaction: "like"}` が feedback テーブルに保存される
- [ ] 👎 リアクション → `{user_id, arxiv_id, reaction: "dislike"}` が feedback テーブルに保存される
- [ ] リアクション削除時にレコードが削除される
- [ ] メッセージ ts から arxiv_id が正しく特定される

### AC3: フィードバック学習
- [ ] 週次（月曜 JST 5:00）で weight-adjuster Lambda が自動実行される
- [ ] 過去 4 週間のフィードバックデータが集計される
- [ ] 各ウェイト要素の「予測力」（Like との相関）に基づきウェイトが再計算される
- [ ] 新しいウェイトが config テーブルに保存される
- [ ] ウェイトの合計が 1.0 に正規化される
- [ ] 最小ウェイトが 0.05（完全無視を防止）

### AC4: インフラ
- [ ] API Gateway HTTP API が Terraform で管理される
- [ ] スロットリング: 10 req/sec, バースト 20
- [ ] API Gateway アクセスログが CloudWatch に記録される
- [ ] feedback Lambda に DLQ が設定される
- [ ] EventBridge 週次スケジュールが Terraform で管理される

## 5. 制約事項

- Slack Bot Token は Secrets Manager で管理
- Slack Signing Secret は Secrets Manager で管理
- API Gateway は認証なし（Slack 署名検証をアプリ層で実施）
- フィードバックは全ユーザー集約（ユーザーごとのパーソナライズは Phase 3 以降）

## 6. 前提条件

- Phase 1 が正常稼働していること
- Slack App に Bot Token Scopes が追加済みであること
- Slack App の Events API Request URL に API Gateway エンドポイントが設定済みであること
- Slack Signing Secret が Secrets Manager に登録済みであること（Phase 1 で箱は作成済み）
