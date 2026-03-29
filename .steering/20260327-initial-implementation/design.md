# 初回実装（Phase 1）設計

## 1. 実装アプローチ

### 実装順序

インフラ基盤 → アプリケーション（下流→上流）→ 統合テスト の順で構築する。

```
Step 1: Terraform 基盤構築（DynamoDB, S3, CloudFront, ECR, EventBridge, IAM, 監視）
Step 2: Lambda collector（論文収集）
Step 3: Lambda scorer（スコアリング・フィルタリング）
Step 4: Fargate summarizer（要約生成 + 詳細ページ生成）
Step 5: Lambda deliverer（Slack 配信）
Step 6: パイプライン結合（EventBridge → collector → scorer → Fargate → deliverer）
Step 7: CI/CD（GitHub Actions）
Step 8: 統合テスト・動作確認
```

**理由:** インフラが先にないとアプリケーションのデプロイ先がない。アプリは下流（collector）から上流（deliverer）へ順に実装し、各ステップ単体で動作確認可能にする。

## 2. 変更するコンポーネント（新規作成）

### ディレクトリ構成（Phase 1 で作成するもの）

```
ai-papers-digest/
├── src/
│   ├── lambdas/
│   │   ├── collector/
│   │   │   ├── handler.py
│   │   │   ├── arxiv_client.py
│   │   │   ├── hf_client.py
│   │   │   ├── s2_client.py
│   │   │   ├── paper_merger.py
│   │   │   └── requirements.txt
│   │   ├── scorer/
│   │   │   ├── handler.py
│   │   │   ├── scoring.py
│   │   │   ├── filter.py
│   │   │   └── requirements.txt
│   │   ├── deliverer/
│   │   │   ├── handler.py
│   │   │   ├── slack_client.py
│   │   │   ├── message_builder.py
│   │   │   └── requirements.txt
│   │   └── layer/
│   │       ├── requirements.txt
│   │       └── build.sh
│   ├── summarizer/
│   │   ├── Dockerfile
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── summarizer.js
│   │   │   ├── claude-client.js
│   │   │   ├── dynamo-client.js
│   │   │   ├── s3-uploader.js
│   │   │   ├── html-generator.js
│   │   │   └── quality-judge.js
│   │   └── templates/
│   │       ├── paper-detail.html
│   │       └── daily-digest.html
│   └── shared/
│       └── constants.py
├── terraform/
│   ├── modules/
│   │   ├── dynamodb/
│   │   ├── lambda/
│   │   ├── ecs/
│   │   ├── s3-cloudfront/
│   │   ├── eventbridge/
│   │   └── monitoring/
│   └── environments/
│       └── prod/
├── tests/
│   ├── unit/
│   │   ├── lambdas/
│   │   └── summarizer/
│   └── fixtures/
├── static/
│   └── style.css
├── .github/
│   └── workflows/
│       ├── ci.yml
│       └── deploy.yml
├── pyproject.toml
├── requirements-dev.txt
└── .gitignore
```

## 3. 各コンポーネントの実装設計

### 3.1 Terraform 基盤（Step 1）

**作成するモジュールと主なリソース:**

| モジュール | リソース | 備考 |
|-----------|---------|------|
| `dynamodb` | 5テーブル + 2 GSI | papers, summaries, delivery_log, paper_sources, config |
| `lambda` | 共通モジュール（3回呼び出し） | IAMロール、DLQ、ロググループ含む |
| `ecs` | クラスター、タスク定義、SG、VPC | Fargate SPOT、インバウンド全拒否 SG |
| `s3-cloudfront` | S3バケット、OAC、CF ディストリビューション | Geo制限 JP、ライフサイクル 90日 |
| `eventbridge` | 日次スケジュール、ECS状態変更ルール | cron(0 21 * * ? *) = JST 6:00 |
| `monitoring` | Alarms 7件、SNSトピック、ロググループ | メール通知 |

**Fargate 用 VPC の最小構成:**

```hcl
# ECS Fargate にはVPCが必須（awsvpc モード）
# パブリックサブネット 2つ（AZ冗長）+ インターネットゲートウェイ
# セキュリティグループ: インバウンド全拒否、アウトバウンド HTTPS のみ

VPC CIDR: 10.0.0.0/24（最小限、256アドレス）
├── public-subnet-1a: 10.0.0.0/25  (ap-northeast-1a)
└── public-subnet-1c: 10.0.0.128/25 (ap-northeast-1c)
```

**Terraform state バックエンド:**
- 手動で事前作成（S3バケット + DynamoDBロックテーブル）
- Terraform 管理外（bootstrap リソース）

### 3.2 Lambda collector（Step 2）

**handler.py フロー:**

```python
def handler(event, context):
    date = event.get("date", today())

    # 1. 並列データ収集
    hf_papers = hf_client.fetch_daily_papers(date)
    arxiv_papers = arxiv_client.fetch_recent_papers(TARGET_CATEGORIES)

    # 2. arXiv ID ベースで統合
    merged = paper_merger.merge(hf_papers, arxiv_papers)

    # 3. Semantic Scholar で補完
    arxiv_ids = [p["arxiv_id"] for p in merged]
    s2_data = s2_client.fetch_batch(arxiv_ids)
    enriched = paper_merger.enrich(merged, s2_data)

    # 4. DynamoDB に保存
    for paper in enriched:
        dynamo.put_item(PAPERS_TABLE, paper)

    # 5. scorer を非同期呼び出し
    lambda_client.invoke(SCORER_FUNCTION_NAME, {"date": date})
```

**外部 API クライアント設計:**

| ファイル | 責務 | エラーハンドリング |
|---------|------|----------------|
| `hf_client.py` | `GET /api/daily_papers?date={date}` | 失敗時: 空リスト返却、ログ出力 |
| `arxiv_client.py` | `GET /api/query?search_query=cat:{cat}&...` × 5カテゴリ | 3秒インターバル、失敗カテゴリはスキップ |
| `s2_client.py` | `POST /paper/batch` | 失敗時: s2 フィールドを None で埋める |

**arxiv_client の XML パース:**

```python
import feedparser

def fetch_recent_papers(categories: list[str]) -> list[dict]:
    papers = []
    for cat in categories:
        time.sleep(3)  # arXiv レート制限
        url = f"https://export.arxiv.org/api/query?search_query=cat:{cat}&sortBy=submittedDate&sortOrder=descending&max_results=50"
        feed = feedparser.parse(url)
        for entry in feed.entries:
            papers.append({
                "arxiv_id": extract_arxiv_id(entry.id),
                "title": entry.title,
                "abstract": entry.summary,
                "authors": [a.name for a in entry.authors],
                "categories": [t.term for t in entry.tags],
                "published_date": entry.published,
            })
    return papers
```

### 3.3 Lambda scorer（Step 3）

**scoring.py のアルゴリズム:**

```python
def calculate_score(paper: dict, weights: dict, all_papers: list[dict]) -> float:
    hf_vals = [p.get("hf_upvotes", 0) for p in all_papers]
    s2_vals = [p.get("s2_citation_count", 0) for p in all_papers]
    src_vals = [p.get("source_count", 1) for p in all_papers]

    score = (
        weights["w1"] * normalize(paper.get("hf_upvotes", 0), hf_vals)
        + weights["w2"] * normalize(paper.get("s2_citation_count", 0), s2_vals)
        + weights["w3"] * normalize(paper.get("source_count", 1), src_vals)
        + weights["w4"] * 0  # feedback_bonus: Phase 2 で有効化
    )
    return round(score, 4)

def normalize(x: float, values: list[float]) -> float:
    min_v, max_v = min(values), max(values)
    if max_v == min_v:
        return 0.0
    return (x - min_v) / (max_v - min_v)
```

**filter.py の除外ロジック:**

```python
def filter_papers(scored_papers: list[dict], delivered_ids: set[str], top_n: int) -> list[dict]:
    # 配信済みを除外
    candidates = [p for p in scored_papers if p["arxiv_id"] not in delivered_ids]
    # スコア降順でソート
    candidates.sort(key=lambda p: p["score"], reverse=True)
    # 上位 N 本
    return candidates[:top_n]
```

### 3.4 Fargate summarizer（Step 4）

**summarizer.js メインフロー:**

```javascript
async function main() {
  const date = process.env.TARGET_DATE || todayJST();
  const paperIds = JSON.parse(process.env.PAPER_IDS);

  for (const arxivId of paperIds) {
    // 1. DynamoDB から論文データ読取
    const paper = await dynamoClient.getPaper(arxivId);

    // 2. Claude CLI で 2 層要約生成
    const summary = await claudeClient.generateSummary(paper);

    // 3. 品質比較（HF ai_summary がある場合）
    if (paper.hf_ai_summary) {
      const judged = await qualityJudge.compare(summary, paper.hf_ai_summary);
      // 高スコア側を採用（ただし構造化テンプレートに整形）
    }

    // 4. DynamoDB に保存
    await dynamoClient.putSummary(arxivId, summary);

    // 5. S3 に詳細ページ HTML アップロード
    const html = htmlGenerator.renderDetail(paper, summary);
    await s3Uploader.upload(`papers/${arxivId}.html`, html);

    // 6. 論文間インターバル（Max プラン レート制限対策）
    await sleep(10_000);
  }

  // 7. 日次ダイジェストページ生成
  const allSummaries = await dynamoClient.getSummariesByDate(date);
  const digestHtml = htmlGenerator.renderDigest(date, allSummaries);
  await s3Uploader.upload(`digest/${date}.html`, digestHtml);
}
```

**claude-client.js の実装:**

```javascript
const { execSync } = require('child_process');

function generateSummary(paper) {
  const prompt = buildPrompt(paper);
  const result = execSync('claude -p --output-format json --max-turns 1', {
    input: prompt,
    encoding: 'utf-8',
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });

  const parsed = JSON.parse(result);
  // compact_summary の文字数バリデーション
  if (parsed.compact_summary.length < 200 || parsed.compact_summary.length > 400) {
    // リトライ（1回のみ）
    return generateSummary(paper);  // 再帰リトライ上限はcaller側で管理
  }
  return parsed;
}
```

**html-generator.js のテンプレート方式:**

- テンプレートエンジンは使わず、`String.replace()` でプレースホルダーを置換
- `templates/paper-detail.html` に `{{title_ja}}` `{{novelty}}` 等のプレースホルダーを配置
- XSS 対策: HTML エスケープ関数で全フィールドをサニタイズしてから埋め込み

### 3.5 Lambda deliverer（Step 5）

**message_builder.py の Slack Block Kit 構築:**

```python
def build_paper_message(summary: dict, detail_page_url: str) -> dict:
    return {
        "blocks": [
            {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": (
                        f"*📄 {summary['title_original']}*\n"
                        f"_{summary['title_ja']}_\n\n"
                        f"{summary['compact_summary']}\n\n"
                        f"🏷️ {format_tags(summary['tags'])}"
                    ),
                },
            },
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📋 詳細を見る"},
                        "url": detail_page_url,
                        "style": "primary",
                    },
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "📖 arXiv"},
                        "url": f"https://arxiv.org/abs/{summary['arxiv_id']}",
                    },
                ],
            },
            {"type": "divider"},
        ]
    }
```

**slack_client.py:**

```python
import requests

def post_message(webhook_url: str, blocks: dict) -> str:
    resp = requests.post(webhook_url, json=blocks, timeout=10)
    resp.raise_for_status()
    # Incoming Webhook はメッセージ ts を返さない
    # → delivery_log には日付 + arxiv_id のみ記録
    return resp.text
```

> **注意:** Incoming Webhook はレスポンスに `ts`（メッセージタイムスタンプ）を返さない。Phase 2 のリアクション収集で `ts` が必要になるため、Phase 2 移行時に `chat.postMessage` API（Bot Token）への切り替えが必要。Phase 1 ではこの制約を受け入れる。

### 3.6 パイプライン結合（Step 6）

**EventBridge → collector → scorer → Fargate → deliverer の連携:**

```
[EventBridge Schedule]
    │ cron(0 21 * * ? *)  = JST 6:00 (UTC 21:00)
    ▼
[collector Lambda]
    │ Lambda.invoke(scorer, InvocationType='Event')
    ▼
[scorer Lambda]
    │ ECS.runTask(summarizer, overrides={PAPER_IDS, TARGET_DATE})
    ▼
[Fargate summarizer]
    │ (タスク完了)
    ▼
[EventBridge Rule: ECS Task State Change]
    │ detail.lastStatus = "STOPPED", detail.containers[0].exitCode = 0
    ▼
[deliverer Lambda]
```

**scorer → Fargate のパラメータ渡し:**

```python
ecs.run_task(
    cluster=ECS_CLUSTER,
    taskDefinition=ECS_TASK_DEFINITION,
    launchType="FARGATE",
    capacityProviderStrategy=[{"capacityProvider": "FARGATE_SPOT", "weight": 1}],
    networkConfiguration={...},
    overrides={
        "containerOverrides": [{
            "name": "summarizer",
            "environment": [
                {"name": "PAPER_IDS", "value": json.dumps(selected_ids)},
                {"name": "TARGET_DATE", "value": date},
            ],
        }],
    },
)
```

### 3.7 CI/CD（Step 7）

**ci.yml（PR 時）:**

```yaml
jobs:
  lint-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install ruff mypy pytest moto boto3-stubs
      - run: ruff check src/
      - run: ruff format --check src/
      - run: mypy src/lambdas/
      - run: pytest tests/unit/

  terraform-plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: cd terraform/environments/prod && terraform init && terraform plan
```

**deploy.yml（main マージ時）:**

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # テスト
      - run: pytest tests/unit/
      # ECR push
      - uses: aws-actions/amazon-ecr-login@v2
      - run: |
          docker build -t summarizer src/summarizer/
          docker tag summarizer $ECR_URI:latest
          docker push $ECR_URI:latest
      # Terraform apply
      - run: cd terraform/environments/prod && terraform init && terraform apply -auto-approve
      # 静的アセット同期
      - run: aws s3 sync static/ s3://$PAGES_BUCKET/assets/
```

## 4. データ構造の変更

新規プロジェクトのため全テーブルが新規作成。変更なし。

## 5. 影響範囲の分析

新規プロジェクトのため影響範囲なし。以下を事前確認:

| 確認事項 | 対応 |
|---------|------|
| AWS アカウントのサービスクォータ | Lambda 同時実行、Fargate タスク数を確認 |
| Claude Max プランのレート制限 | 7論文 × 10秒インターバル = 最低70秒。問題なし |
| Slack Incoming Webhook の制限 | 1メッセージ/秒。8メッセージ = 約10秒。問題なし |
| arXiv API のレート制限 | 5カテゴリ × 3秒 = 15秒。問題なし |
| S2 Batch API の制限 | 1リクエスト（最大500件）。問題なし |

## 6. リスクと軽減策

| リスク | 影響 | 軽減策 |
|--------|------|--------|
| Claude CLI の Max 認証が Fargate で動作しない | 要約生成が不可能 | 事前に手動で Fargate タスクから `claude -p` を実行して検証。ダメなら CodeBuild に切り替え |
| Fargate SPOT 中断 | 当日の配信遅延 | EventBridge で SPOT 中断検知 → オンデマンドでリトライ |
| arXiv API の一時停止 | 論文収集が不完全 | HF + S2 のみでも配信可能な設計。arXiv 失敗をスキップ |
| HF Daily Papers API の仕様変更 | upvote 取得不可 | arXiv + S2 でスコアリング継続可能（HF ウェイトを 0 に） |
| コンパクト要約の文字数が安定しない | 200〜400文字の範囲外 | プロンプトで文字数を強調 + バリデーション + 1回リトライ |
