# ユビキタス言語定義

## 1. ドメイン用語

| 用語（日本語） | 用語（英語） | コード上の命名 | 定義 |
|--------------|------------|-------------|------|
| 論文 | Paper | `paper` | arXiv に投稿された学術論文。本システムの処理対象の最小単位 |
| アブストラクト | Abstract | `abstract` | 論文の要旨。arXiv API から取得される英語の原文 |
| コンパクト要約 | Compact Summary | `compact_summary` | Slack 配信用の日本語要約（200〜400文字）。新規性・手法・結果のエッセンスを1段落に凝縮 |
| 詳細要約 | Detailed Summary | `detail` | S3 詳細ページ用の構造化日本語要約。新規性・手法・結果・実装可能性の4セクション |
| 要約 | Summary | `summary` | コンパクト要約と詳細要約の総称 |
| 注目度スコア | Attention Score | `score` | 複数シグナルから算出される論文の注目度を示す数値（0.0〜1.0） |
| フィードバック | Feedback | `feedback` | ユーザーが要約に対して付与する Like/Dislike 評価 |
| 嗜好プロファイル | Preference Profile | `preference_profile` | フィードバックの蓄積から構築されるユーザーの興味傾向 |
| スコアリングウェイト | Scoring Weights | `scoring_weights` | スコア算出時の各要素の重み（w1〜w4） |
| 配信 | Delivery | `delivery` | 生成された要約を Slack チャンネルに投稿すること |
| ダイジェスト | Digest | `digest` | ある日に配信された論文要約の一覧（日次ダイジェスト） |
| 分野タグ | Tag | `tag` / `tags` | 論文の AI サブカテゴリ（例: LLM, Vision, RL, Transformer） |
| 詳細ページ | Detail Page | `detail_page` | S3 にホスティングされる論文ごとの詳細要約 HTML ページ |

## 2. データソース用語

| 用語（日本語） | 用語（英語） | コード上の命名 | 定義 |
|--------------|------------|-------------|------|
| arXiv ID | arXiv ID | `arxiv_id` | arXiv が論文に付与する一意識別子（例: `2603.18718`）。本システムの論文ユニークキー |
| arXiv カテゴリ | arXiv Category | `category` / `categories` | arXiv の分類体系（例: cs.AI, cs.CL, cs.CV, cs.LG, stat.ML） |
| HF upvote | HF Upvote | `hf_upvotes` | Hugging Face Papers ページでのコミュニティ投票数 |
| HF AI要約 | HF AI Summary | `hf_ai_summary` | Hugging Face が自動生成した英語の論文要約 |
| HF AIキーワード | HF AI Keywords | `hf_ai_keywords` | Hugging Face が自動抽出したキーワード |
| 引用数 | Citation Count | `s2_citation_count` | Semantic Scholar における被引用数 |
| TLDR | TLDR | `s2_tldr` | Semantic Scholar が自動生成した1文の論文要約（英語） |
| SPECTER2 | SPECTER2 | `s2_embedding` | Semantic Scholar の論文埋め込みベクトル（768次元） |
| ソース出現数 | Source Count | `source_count` | 論文が検出されたデータソースの数（1〜3） |

## 3. システム・アーキテクチャ用語

| 用語（日本語） | 用語（英語） | コード上の命名 | 定義 |
|--------------|------------|-------------|------|
| 収集 | Collection | `collector` | 外部 API から論文メタデータを取得・統合するステップ |
| スコアリング | Scoring | `scorer` | 論文に注目度スコアを付与し、上位を選出するステップ |
| 要約生成 | Summarization | `summarizer` | Claude CLI で要約を生成するステップ |
| 品質比較 | Quality Judgment | `quality_judge` | 自動生成要約と既存要約の品質をLLMで比較するプロセス |
| 配信ログ | Delivery Log | `delivery_log` | 日次の配信記録。配信済み論文ID、Slack メッセージTS、Like/Dislike数を保持 |
| 日次バッチ | Daily Batch | `daily_batch` | 毎朝実行される収集→スコアリング→要約→配信の一連のパイプライン |
| パイプライン | Pipeline | `pipeline` | 日次バッチの処理フロー全体を指す |
| DLQ | Dead Letter Queue | `dlq` | Lambda の処理失敗メッセージを退避する SQS キュー |
| ベクトルバケット | Vector Bucket | `vector_bucket` | S3 Vectors のバケットタイプ。ベクトルデータの格納・クエリに特化 |
| ベクトルインデックス | Vector Index | `vector_index` | ベクトルバケット内のインデックス。類似度検索の単位 |

## 4. ビジネス用語

| 用語（日本語） | 用語（英語） | 定義 |
|--------------|------------|------|
| 日次プッシュ型 | Daily Push | ユーザーが検索せずとも毎朝自動的に要約が届くサービス形態 |
| キュレーション | Curation | 大量の論文から質の高いものを選定するプロセス |
| パーソナライズ | Personalization | フィードバックに基づき個人の嗜好に適応すること |
| スクリーニング | Screening | 論文タイトルや要約を見て深読みするか判断する行為 |
| Like 率 | Like Rate | 配信された要約のうち Like が付いた割合（KPI） |

## 5. UI / UX 用語

| 用語（日本語） | 用語（英語） | 定義 |
|--------------|------------|------|
| 論文カード | Paper Card | Slack メッセージまたは Web ページ上の1論文分の表示ブロック |
| リアクション | Reaction | Slack の絵文字リアクション（👍 = Like, 👎 = Dislike） |
| 詳細を見るリンク | Detail Link | Slack メッセージから S3 詳細ページへ遷移するボタン |
| ヘッダーメッセージ | Header Message | 日次配信の最初に送信される「本日の論文数 + ダイジェストリンク」メッセージ |

## 6. 英語・日本語対応表（コード上で頻出）

| 英語 | 日本語 | コード上の使用例 |
|------|--------|---------------|
| paper | 論文 | `paper`, `paper_list`, `paper_ids` |
| summary | 要約 | `summary`, `compact_summary`, `detail` |
| score | スコア | `score`, `scoring_weights` |
| feedback | フィードバック | `feedback`, `reaction` |
| delivery | 配信 | `delivery_log`, `deliver()` |
| collect | 収集 | `collector`, `collect_papers()` |
| filter | フィルタリング | `filter`, `filter_papers()` |
| tag | タグ | `tags`, `ai_keywords` |
| novelty | 新規性 | `detail_novelty` |
| method | 手法 | `detail_method` |
| results | 結果 | `detail_results` |
| practicality | 実装可能性 | `detail_practicality` |
| digest | ダイジェスト | `daily-digest.html`, `digest/` |
| weight | ウェイト | `scoring_weights`, `w1`〜`w4` |
| upvote | アップボート | `hf_upvotes` |
| citation | 引用 | `s2_citation_count` |

## 7. 略語一覧

| 略語 | 正式名称 | 説明 |
|------|---------|------|
| HF | Hugging Face | 論文データソースの1つ |
| S2 | Semantic Scholar | 論文データソースの1つ |
| DDB | DynamoDB | AWS NoSQL データベース |
| SM | Secrets Manager | AWS シークレット管理サービス |
| CF | CloudFront | AWS CDN サービス |
| EB | EventBridge | AWS イベントバスサービス |
| ECS | Elastic Container Service | AWS コンテナオーケストレーション |
| ECR | Elastic Container Registry | AWS コンテナイメージレジストリ |
| DLQ | Dead Letter Queue | 失敗メッセージの退避キュー |
| OAC | Origin Access Control | CloudFront → S3 のアクセス制御 |
| PITR | Point-in-Time Recovery | DynamoDB のポイントインタイムリカバリ |
| SG | Security Group | AWS のファイアウォールルール |
| IAM | Identity and Access Management | AWS の認証・認可サービス |
| IaC | Infrastructure as Code | インフラのコード管理 |
| PR | Pull Request | コードレビューリクエスト |
| S3V | S3 Vectors | AWS のベクトルストアサービス（vector bucket） |
