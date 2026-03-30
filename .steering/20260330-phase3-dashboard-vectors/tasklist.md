# Phase 3 タスクリスト — Web ダッシュボード + セマンティック検索

## Step 1: S3 Vectors 環境構築

- [ ] 1.1 Bedrock Titan Embeddings V2 のモデルアクセス有効化確認
  - ap-northeast-1 で `amazon.titan-embed-text-v2:0` が利用可能か確認
  - 利用不可の場合は Semantic Scholar SPECTER2 embedding で代替
- [ ] 1.2 S3 Vectors の boto3/SDK 対応確認
  - `@aws-sdk/client-s3vectors` が Node.js SDK v3 に存在するか確認
  - 未提供の場合は Python Lambda にフォールバック or AWS CLI 経由
- [ ] 1.3 S3 Vectors リソース作成
  - vector bucket: `ai-papers-digest-vectors`
  - vector index: `paper-embeddings`（dimension=768, metric=cosine）
  - Terraform 対応があれば Terraform、なければ boto3 スクリプト
- [ ] 1.4 Fargate タスクロールに IAM 権限追加（Terraform）
  - `s3vectors:PutVectors`, `s3vectors:QueryVectors`, `s3vectors:GetVectors`
  - `bedrock:InvokeModel`（amazon.titan-embed-text-v2:0）

## Step 2: summarizer 拡張（埋め込み + ベクトル保存 + 類似論文）

- [ ] 2.1 `src/summarizer/src/embedding-client.js` 実装
  - Bedrock Titan Embeddings V2 で 768次元ベクトル生成
  - 入力: `title + " " + compact_summary`
- [ ] 2.2 `src/summarizer/src/vectors-client.js` 実装
  - `putVector(arxivId, embedding, metadata)`
  - `querySimilar(embedding, topK, excludeKey)`
- [ ] 2.3 `src/summarizer/src/summarizer.js` 拡張
  - 要約生成後に埋め込み生成 + S3 Vectors 保存
  - 全論文完了後に類似論文クエリ + 詳細ページ再生成
- [ ] 2.4 動作確認：ベクトル保存 + 類似論文クエリが成功すること

## Step 3: 詳細ページテンプレート更新

- [ ] 3.1 `src/summarizer/templates/paper-detail.html` 更新
  - 類似論文セクション追加（タイトル + 一言サマリー + 類似度 + リンク）
- [ ] 3.2 `src/summarizer/src/html-generator.js` 更新
  - `renderDetail()` に similar_papers パラメータ追加
- [ ] 3.3 `static/style.css` 更新
  - 類似論文カードのスタイル追加

## Step 4: ダッシュボードページ生成

- [ ] 4.1 `src/summarizer/src/dashboard-generator.js` 実装
  - DynamoDB から全 summaries 取得
  - タグ集計
  - 各種ページ生成 + S3 アップロード
- [ ] 4.2 テンプレート作成
  - `src/summarizer/templates/tag-list.html`（タグ一覧）
  - `src/summarizer/templates/tag-page.html`（タグ別論文一覧）
  - `src/summarizer/templates/search.html`（検索ページ）
- [ ] 4.3 `src/summarizer/templates/daily-digest.html` 更新
  - ヘッダーにタグ一覧・検索ページへのナビゲーション追加
- [ ] 4.4 `index.html` のリダイレクトロジック更新
- [ ] 4.5 summarizer.js にダッシュボード生成ステップを追加

## Step 5: クライアントサイド検索

- [ ] 5.1 `static/search.js` 実装
  - lunr.js で search-index.json をロード
  - 日本語トークナイズ対応（TinySegmenter）
  - インクリメンタル検索 + 結果表示
- [ ] 5.2 dashboard-generator.js に search-index.json 生成を追加
- [ ] 5.3 検索ページの動作確認

## Step 6: 統合テスト・デプロイ

- [ ] 6.1 Docker イメージ再ビルド + ECR プッシュ
- [ ] 6.2 Fargate タスク手動実行で E2E 確認
  - 埋め込み生成 → S3 Vectors 保存 → 類似論文取得 → HTML 生成
  - ダッシュボードページ（トップ、タグ一覧、検索）が S3 にアップロードされること
- [ ] 6.3 CloudFront 経由で全ページにアクセスできることを確認
  - 詳細ページの類似論文セクション
  - タグ一覧・タグ別ページ
  - 検索ページでキーワード検索
- [ ] 6.4 モバイル表示の確認
- [ ] 6.5 コミット・プッシュ
- [ ] 6.6 docs/ 更新（Phase 3 完了を反映）
