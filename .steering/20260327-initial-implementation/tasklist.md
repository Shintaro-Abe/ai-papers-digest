# 初回実装（Phase 1）タスクリスト

## Step 1: Terraform 基盤構築

- [x] 1.1 プロジェクトルートの設定ファイル作成
- [x] 1.2 Terraform バックエンド用 bootstrap スクリプト作成
- [x] 1.3 Terraform モジュール: `dynamodb`（全テーブル PITR 有効化）
- [x] 1.4 Terraform モジュール: `ecs`（ECR IMMUTABLE + スキャン有効）
- [x] 1.5 Terraform モジュール: `lambda`（SQS DLQ SSE-SQS 暗号化有効）
- [x] 1.6 Terraform モジュール: `s3-cloudfront`
- [x] 1.7 Terraform モジュール: `eventbridge`
- [x] 1.8 Terraform モジュール: `monitoring`（SNS aws/sns 暗号化）
- [x] 1.9 Terraform 環境構成: `environments/prod`
- [x] 1.10 Secrets Manager リソース（4シークレット）
- [x] 1.11 Terraform validate 全モジュール Success
- [x] 1.12 Trivy v0.69.3 セキュリティスキャン実施・指摘修正
- [x] 1.13 `terraform apply` 完了（64リソース作成）
- [x] 1.14 CodeBuild モジュール追加 + Docker イメージビルド・ECR プッシュ

## Step 2: Lambda collector（論文収集）

- [x] 2.1 `src/shared/constants.py` 作成
- [x] 2.2 `src/lambdas/layer/requirements.txt` + `build.sh` 作成
- [x] 2.3 `src/lambdas/collector/hf_client.py` 実装
- [x] 2.4 `src/lambdas/collector/arxiv_client.py` 実装
- [x] 2.5 `src/lambdas/collector/s2_client.py` 実装
- [x] 2.6 `src/lambdas/collector/paper_merger.py` 実装
- [x] 2.7 `src/lambdas/collector/handler.py` 実装
- [x] 2.8 ユニットテスト: `tests/unit/lambdas/test_collector.py`（10テスト全パス）
- [x] 2.9 Lambda デプロイ・動作確認（204本収集・保存成功）

## Step 3: Lambda scorer（スコアリング）

- [x] 3.1 `src/lambdas/scorer/scoring.py` 実装
- [x] 3.2 `src/lambdas/scorer/filter.py` 実装
- [x] 3.3 `src/lambdas/scorer/handler.py` 実装
- [x] 3.4 ユニットテスト: `tests/unit/lambdas/test_scorer.py`（11テスト全パス）
- [x] 3.5 Lambda デプロイ・動作確認（7本選出 + Fargate タスク起動成功）

## Step 4: Fargate summarizer（要約生成 + 詳細ページ）

- [x] 4.1 Claude CLI の Fargate 動作検証（CLAUDE_ACCESS_TOKEN 認証成功）
- [x] 4.2 `src/summarizer/package.json` 作成
- [x] 4.3 `src/summarizer/src/claude-client.js` 実装
- [x] 4.4 `src/summarizer/src/dynamo-client.js` 実装
- [x] 4.5 `src/summarizer/src/quality-judge.js` 実装
- [x] 4.6 `src/summarizer/src/html-generator.js` 実装
- [x] 4.7 `src/summarizer/templates/` 作成
- [x] 4.8 `static/style.css` 作成
- [x] 4.9 `src/summarizer/src/s3-uploader.js` 実装
- [x] 4.10 `src/summarizer/src/summarizer.js` 実装
- [x] 4.11 `src/summarizer/Dockerfile` + `entrypoint.sh` 作成
- [x] 4.12 ユニットテスト: `tests/unit/summarizer/html-generator.test.js`（39テスト全パス）
- [x] 4.13 Docker ビルド・ECR プッシュ（CodeBuild 経由）
- [x] 4.14 Fargate タスク手動実行・動作確認（要約生成 + S3 HTML アップロード成功）

## Step 5: Lambda deliverer（Slack 配信）

- [x] 5.1 `src/lambdas/deliverer/message_builder.py` 実装
- [x] 5.2 `src/lambdas/deliverer/slack_client.py` 実装
- [x] 5.3 `src/lambdas/deliverer/handler.py` 実装
- [x] 5.4 ユニットテスト: `tests/unit/lambdas/test_deliverer.py`（6テスト全パス）
- [x] 5.5 Lambda デプロイ・動作確認（Slack チャンネルにメッセージ配信成功）

## Step 6: パイプライン結合

- [x] 6.1 EventBridge 日次スケジュールの有効化（ENABLED, cron(0 21 * * ? *)）
- [x] 6.2 ECS Task State Change ルールの動作確認
- [x] 6.3 E2E パイプラインテスト（collector → scorer → Fargate → deliverer → Slack 配信成功）
- [ ] 6.4 エラーケースの確認（運用中に随時確認）

## Step 7: CI/CD

- [x] 7.1 `.github/workflows/ci.yml` 作成
- [x] 7.2 `.github/workflows/deploy.yml` 作成
- [ ] 7.3 GitHub Actions の動作確認（リポジトリ push 後に実施）

## Step 8: 統合テスト・仕上げ

- [x] 8.1 日次バッチの自動実行設定完了（翌朝 JST 6:00 に自動実行予定）
- [ ] 8.2 パフォーマンス確認（翌朝の自動実行結果で確認）
- [x] 8.3 監視・アラート設定完了（CloudWatch Alarms 3件 + SNS メール通知）
- [x] 8.4 config テーブル初期データ投入済み（scoring_weights）
- [x] 8.5 S3 静的アセットのデプロイ完了（style.css）
- [x] 8.6 ドキュメント更新完了（docs/ 7ファイル + Trivy スキャン結果反映）
- [x] 8.7 README.md 作成完了

## E2E テスト中に修正した問題（6件）

1. scorer: GSI が score=null のアイテムを含まない → Scan に変更
2. scorer: dynamodb:Scan 権限追加
3. scorer: `launchType` と `capacityProviderStrategy` の重複削除
4. scorer: タスク定義をファミリー名に変更 + IAM ワイルドカード化
5. entrypoint.sh: credentials.json 全体を書き出す方式に変更（承認済み）
6. deliverer: UTC/JST 日付フィルタの両対応 + Scan 権限追加
