# 初回実装（Phase 1）要求内容

## 1. 概要

Phase 1 として、論文収集から Slack 配信までの日次パイプラインを構築する。
フィードバック機能（Phase 2）、Web ダッシュボード（Phase 3）は対象外。

## 2. スコープ

### 対象機能（PRD F1〜F7）

| # | 機能 | 概要 |
|---|------|------|
| F1 | 論文収集 | arXiv / HF / Semantic Scholar から日次取得 |
| F2 | 論文スコアリング | 注目度スコア算出 |
| F3 | 論文フィルタリング | 上位 N 本を選出、配信済み除外 |
| F4 | 要約生成（2層） | コンパクト要約（200〜400文字）+ 詳細要約 |
| F5 | 既存要約の品質比較 | HF ai_summary との比較・採用判定 |
| F6 | 詳細ページ生成 | S3 静的ページの生成・ホスティング |
| F7 | Slack 配信 | コンパクト要約 + 詳細リンクを Slack 投稿 |

### 対象インフラ

- Lambda × 3（collector, scorer, deliverer）
- ECS Fargate タスク × 1（summarizer）
- DynamoDB テーブル × 5（papers, summaries, delivery_log, paper_sources, config）
- S3 + CloudFront（詳細ページホスティング）
- EventBridge（日次スケジュール + ECS 状態変更ルール）
- ECR（Docker イメージ管理）
- Secrets Manager（Slack Webhook, S2 API Key, Claude Auth Token）
- CloudWatch（ログ、アラーム）+ SNS（通知）+ SQS（DLQ）

### スコープ外

- フィードバック収集（Phase 2）→ スコアリングの `feedback_bonus` は初期値 0 で固定
- API Gateway（Phase 2）
- Web ダッシュボード（Phase 3）
- S3 Vectors（Phase 3）
- カスタムドメイン

## 3. ユーザーストーリー（Phase 1 対象）

### US1: 毎朝の論文要約を Slack で確認する
- 毎朝 JST 8:00 までに `#ai-papers-digest` チャンネルに配信される
- 1日 5〜10 本の論文が選定される
- 各要約に arXiv リンクと詳細ページリンクが含まれる

### US2: Slack でサッと概要を掴み、詳細ページで深堀りする
- Slack メッセージ: タイトル + コンパクト要約（200〜400文字）+ タグ + リンクボタン
- 「詳細を見る」リンクで S3 詳細ページに遷移できる
- 詳細ページ: 新規性・手法・結果・実装可能性 + メタデータ

## 4. 受け入れ条件

### AC1: 論文収集
- [ ] arXiv API から対象カテゴリ（cs.AI, cs.CL, cs.CV, cs.LG, stat.ML）の論文を取得できる
- [ ] Hugging Face Daily Papers API から当日の論文 + upvote 数を取得できる
- [ ] Semantic Scholar Batch API で引用数・TLDR を補完取得できる
- [ ] arXiv ID ベースで 3 ソースの論文を統合・重複排除できる
- [ ] 取得した論文データが DynamoDB papers テーブルに保存される

### AC2: スコアリング・フィルタリング
- [ ] 注目度スコアが正しく算出される（w1=0.4, w2=0.2, w3=0.2, w4=0.2）
- [ ] 過去に配信済みの論文が除外される
- [ ] スコア上位 N 本（デフォルト 7）が選出される

### AC3: 要約生成
- [ ] Claude CLI（`claude -p`）で 2 層の日本語要約が生成される
- [ ] コンパクト要約が 200〜400 文字に収まっている
- [ ] 詳細要約が新規性・手法・結果・実装可能性の 4 セクションを含む
- [ ] HF ai_summary が存在する場合、品質比較が実行される
- [ ] 要約が DynamoDB summaries テーブルに保存される

### AC4: 詳細ページ
- [ ] 論文ごとに HTML ページが S3 にアップロードされる
- [ ] 日次ダイジェストページが生成される
- [ ] CloudFront 経由で HTTPS アクセスできる
- [ ] 地理的制限（JP のみ）が適用されている

### AC5: Slack 配信
- [ ] ヘッダーメッセージ（日付 + 論文数）が投稿される
- [ ] 論文ごとに独立したメッセージが投稿される
- [ ] 各メッセージに「詳細を見る」「arXiv」ボタンが含まれる
- [ ] 配信ログが DynamoDB delivery_log テーブルに記録される

### AC6: インフラ
- [ ] 全リソースが Terraform で管理される
- [ ] EventBridge により JST 6:00 に日次バッチが自動実行される
- [ ] パイプライン全体が 30 分以内に完了する
- [ ] エラー時に CloudWatch Alarm → SNS → メール通知が届く
- [ ] 各 Lambda に DLQ が設定されている

### AC7: CI/CD
- [ ] PR 時に lint + test + terraform plan が実行される
- [ ] main マージ時に terraform apply + ECR push が実行される

## 5. 制約事項

- Claude は Max プラン + `claude -p` CLI 経由で使用（API 従量課金は使わない）
- Fargate SPOT を使用（コスト最小化。中断時はオンデマンドでリトライ）
- Fargate セキュリティグループはインバウンド全拒否
- S3 パブリックアクセス全ブロック（CloudFront OAC 経由のみ）
- DynamoDB の summaries / feedback テーブルは PITR 有効
- Terraform state は S3 + DynamoDB ロック + バージョニング有効

## 6. 前提条件

- AWS アカウントが利用可能であること
- Claude Max プランに加入済みであること
- Slack ワークスペースに App を作成し、Incoming Webhook URL を取得済みであること
- Semantic Scholar API キーを取得済みであること
- GitHub リポジトリにプッシュ権限があること
