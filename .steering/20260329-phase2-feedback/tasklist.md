# Phase 2: フィードバック収集 + 学習ループ タスクリスト

## Step 1: Slack App 設定変更 + Secrets Manager 登録

- [ ] 1.1 Slack App に Bot Token Scopes を追加
  - `chat:write`, `channels:history`, `reactions:read`
  - App をワークスペースに再インストール
- [ ] 1.2 Slack App の Bot User OAuth Token を取得
- [ ] 1.3 Secrets Manager に Bot Token を登録
  - 新規シークレット `ai-papers-digest/slack-bot-token` を Terraform で作成
  - `aws secretsmanager put-secret-value` で値を登録
- [ ] 1.4 Slack App の Signing Secret を Secrets Manager に登録
  - `ai-papers-digest/slack-signing-secret`（Phase 1 で箱は作成済み）
- [ ] 1.5 Slack チャンネル ID を取得
  - `#ai-papers-digest` チャンネルの ID（`C0XXXXXXX` 形式）

## Step 2: deliverer Lambda を chat.postMessage に移行

- [ ] 2.1 `src/lambdas/deliverer/slack_client.py` を変更
  - Incoming Webhook → Bot Token + `chat.postMessage` API
  - レスポンスから `ts` を取得して返す
  - Webhook フォールバック機能を残す
- [ ] 2.2 `src/lambdas/deliverer/handler.py` を変更
  - `ts` を delivery_log テーブルに保存
  - 環境変数: `SLACK_WEBHOOK_SECRET_ARN` → `SLACK_BOT_TOKEN_SECRET_ARN` + `SLACK_CHANNEL_ID`
- [ ] 2.3 ユニットテスト更新: `tests/unit/lambdas/test_deliverer.py`
- [ ] 2.4 Terraform 更新: deliverer Lambda の環境変数・IAM ポリシー変更
- [ ] 2.5 デプロイ・動作確認
  - Slack に chat.postMessage で投稿できることを確認
  - delivery_log に ts が保存されることを確認

## Step 3: Terraform インフラ追加

- [ ] 3.1 Terraform: Secrets Manager に `slack-bot-token` シークレット追加
- [ ] 3.2 Terraform モジュール: `api-gateway`
  - HTTP API（v2）、`POST /slack/events` ルート
  - Lambda 統合、スロットリング（10 req/sec）、アクセスログ
- [ ] 3.3 Terraform: Lambda feedback（関数定義、IAM、DLQ）
- [ ] 3.4 Terraform: Lambda weight-adjuster（関数定義、IAM、DLQ）
- [ ] 3.5 Terraform: EventBridge 週次スケジュール（月曜 JST 5:00）
- [ ] 3.6 `terraform apply` でインフラデプロイ

## Step 4: Lambda feedback 実装

- [ ] 4.1 `src/lambdas/feedback/slack_verifier.py` 実装
  - Slack 署名検証（HMAC-SHA256）
  - リプレイ攻撃防止（5分以内のタイムスタンプ）
- [ ] 4.2 `src/lambdas/feedback/reaction_parser.py` 実装
  - リアクション名 → like/dislike のマッピング
  - message_ts → arxiv_id のルックアップ（delivery_log scan）
- [ ] 4.3 `src/lambdas/feedback/handler.py` 実装
  - URL Verification Challenge 対応
  - reaction_added → feedback テーブルに保存
  - reaction_removed → feedback テーブルから削除
- [ ] 4.4 ユニットテスト: `tests/unit/lambdas/test_feedback.py`
  - 署名検証、リアクション解析、ハンドラのテスト
- [ ] 4.5 Lambda デプロイ・動作確認
- [ ] 4.6 Slack Events API の Request URL を設定
  - API Gateway エンドポイント URL を Slack App に登録
  - URL Verification Challenge が通ることを確認

## Step 5: Lambda weight-adjuster 実装

- [ ] 5.1 `src/lambdas/weight_adjuster/weight_optimizer.py` 実装
  - 各要素の予測力計算
  - ウェイト正規化（合計 1.0、最小 0.05）
  - Like 件数 10 件未満ならスキップ
- [ ] 5.2 `src/lambdas/weight_adjuster/handler.py` 実装
  - 過去 4 週間のフィードバック + 論文データ取得
  - ウェイト再計算 → config テーブル更新
- [ ] 5.3 ユニットテスト: `tests/unit/lambdas/test_weight_adjuster.py`
  - 予測力計算、正規化、スキップ条件のテスト
- [ ] 5.4 Lambda デプロイ・動作確認

## Step 6: scorer の feedback_bonus 有効化

- [ ] 6.1 `src/lambdas/scorer/scoring.py` を変更
  - `calculate_feedback_bonus()` 関数を追加
  - 同カテゴリの Like 率に基づくボーナス計算
- [ ] 6.2 `src/lambdas/scorer/handler.py` を変更
  - feedback テーブルからデータ取得
  - feedback_bonus をスコア計算に組み込み
- [ ] 6.3 scorer Lambda の IAM に feedback テーブルの読み取り権限を追加
- [ ] 6.4 ユニットテスト更新: `tests/unit/lambdas/test_scorer.py`
- [ ] 6.5 Lambda デプロイ・動作確認

## Step 7: E2E テスト

- [ ] 7.1 配信テスト
  - deliverer → Slack に chat.postMessage で投稿
  - delivery_log に ts が保存されることを確認
- [ ] 7.2 フィードバック収集テスト
  - Slack で 👍 リアクションを付ける → feedback テーブルに保存されることを確認
  - Slack で 👎 リアクションを付ける → feedback テーブルに保存されることを確認
  - リアクションを外す → feedback テーブルから削除されることを確認
- [ ] 7.3 学習ループテスト
  - weight-adjuster を手動実行 → config テーブルのウェイトが更新されることを確認
  - 更新後のウェイトで scorer が正常にスコアリングすることを確認
- [ ] 7.4 エラーケースの確認
  - 不正な署名のリクエスト → 401 が返ることを確認
  - 対象外のリアクション（❤️ 等） → 無視されることを確認
  - フィードバック 10 件未満 → ウェイト更新がスキップされることを確認

## Step 8: コミット・プッシュ

- [ ] 8.1 gitleaks スキャンでシークレットがないことを確認
- [ ] 8.2 コミット・プッシュ
