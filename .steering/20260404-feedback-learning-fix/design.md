# フィードバック学習システム改修 — 設計

## 1. スコアリング式

### 改修前

```
score = w1 × norm(hf_upvotes) + w2 × norm(s2_citations) + w3 × norm(source_count) + w4 × 0.0
```

w4 がハードコード 0.0 のため、フィードバックは完全に無視されていた。

### 改修後

```
score = w1 × norm(hf_upvotes) + w2 × norm(s2_citations) + w3 × norm(source_count) + w4 × norm(feedback_bonus)
```

| ウェイト | 特徴量 | 初期値 | 説明 |
|---|---|---|---|
| w1 | hf_upvotes | 0.4 | HuggingFace の upvote 数 |
| w2 | s2_citation_count | 0.2 | Semantic Scholar の引用数 |
| w3 | source_count | 0.2 | 出現ソース数（arXiv + HF の重複度） |
| w4 | feedback_bonus | 0.2 | カテゴリベースのフィードバックボーナス |

## 2. feedback_bonus の計算方法

### カテゴリベース類似度

過去に 👍 した論文のカテゴリ傾向をプロファイル化し、同カテゴリの新論文にボーナスを与える。

**手順:**

1. 直近28日間のフィードバック（👍/👎）を取得
2. 各 arXiv カテゴリごとの Like 率を計算（Laplace 平滑化）
3. 新しい論文のカテゴリの平均 Like 率を feedback_bonus とする

**Laplace 平滑化:**

```
preference(category) = (likes + 1) / (total + 2)
```

- Like 0件 / Total 0件 → 計算されない（0.0）
- Like 1件 / Total 1件 → (1+1)/(1+2) = 0.667（1.0 にならない）
- Like 5件 / Total 10件 → (5+1)/(10+2) = 0.5

**Why:** 少数サンプルで極端な値（0.0 や 1.0）になるのを防ぐ。ベイズ統計の Beta 分布の事前分布（Beta(1,1) = 一様分布）に基づく。

**選定理由:**
- papers テーブルに既存の `categories`（`["cs.AI", "cs.CL"]` 等）を活用、スキーマ変更不要
- 少数サンプル（5件〜）でも有効
- 解釈しやすい（「NLP 論文を好む傾向」→ NLP 論文にボーナス）

## 3. ウェイト最適化アルゴリズム

### 実行タイミング

EventBridge: 毎週日曜 20:00 UTC（月曜 05:00 JST）

### 改善点

#### 3.1 ベイズ平滑化（compute_predictive_power）

**改修前:**
```python
ratio = liked_avg / (all_avg + 1e-10)
```

**改修後:**
```python
n = len(liked_papers)
prior = 1.0  # ニュートラル
smoothing_strength = 5  # 擬似観測数
smoothed_ratio = (liked_avg * n + prior * smoothing_strength) / (all_avg * n + smoothing_strength)
```

**Why:** サンプルサイズが小さいとき（n < 5）、prior（ニュートラル値）の影響が大きくなり、極端な値を抑制する。n が大きくなるほどデータが支配する。Fisher の判別比の簡易版にベイズ平滑化を組み合わせた手法。

#### 3.2 最低フィードバック数

```python
MIN_FEEDBACK_COUNT = 5

if total_feedback < MIN_FEEDBACK_COUNT:
    return current_weights  # ウェイト変更しない
```

**Why:** 1-2件のフィードバックで統計的に意味のある傾向は判断できない。

#### 3.3 EMA ブレンド

```python
LEARNING_RATE = 0.3

new_weight = (1 - LEARNING_RATE) * current_weight + LEARNING_RATE * optimized_weight
```

**Why:** 単一週のデータで急激にウェイトが変わるのを防ぐ。Exponential Moving Average（指数移動平均）により、過去のウェイトを70%保持しつつ新しい最適値に30%ずつ近づく。

#### 3.4 w4 カテゴリ予測力

w4 の最適化に `compute_category_predictive_power()` を新規追加。

- 👍 した論文のカテゴリプロファイルと各論文の重複度を計算
- 👍 論文のカテゴリ重複が全体平均より高いほど、カテゴリが予測力を持つと判定
- ベイズ平滑化 + Dislike ペナルティ適用

## 4. データフロー

```
┌──────────────────────────────────────────────────────────┐
│ フィードバック収集（リアルタイム）                           │
│ Slack 👍/👎 → API Gateway → feedback Lambda               │
│ → feedback テーブル: {user_id, arxiv_id, reaction}        │
│ → delivery_log: like_count/dislike_count 更新             │
└──────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        ▼                                      ▼
┌───────────────────────┐      ┌───────────────────────────┐
│ 日次スコアリング        │      │ 週次ウェイト最適化          │
│ scorer Lambda          │      │ weight_adjuster Lambda     │
│                        │      │                            │
│ 1. config からウェイト   │      │ 1. 28日分の feedback 取得   │
│    (w1-w4) 読み込み     │      │ 2. 28日分の papers 取得     │
│ 2. feedback テーブルから │      │ 3. 5件未満 → スキップ       │
│    28日分取得           │      │ 4. 各特徴量の予測力計算     │
│ 3. カテゴリ preference  │      │    (ベイズ平滑化)           │
│    プロファイル構築      │      │ 5. EMA ブレンド             │
│ 4. 各論文のスコア計算:   │      │    (learning_rate=0.3)     │
│    w1×hf + w2×s2       │      │ 6. 正規化 (sum=1, min=0.05)│
│    + w3×src            │      │ 7. config テーブルに保存     │
│    + w4×feedback_bonus │      │                            │
│ 5. Top 7 を選出        │      │                            │
└───────────────────────┘      └───────────────────────────┘
```

## 5. 変更ファイル

| ファイル | 変更内容 |
|---|---|
| `src/lambdas/scorer/scoring.py` | `compute_category_preferences()`, `compute_feedback_bonus()` 追加、`w4 * 0.0` → `w4 * normalize(feedback_bonus)` |
| `src/lambdas/scorer/handler.py` | `_get_recent_feedback()` 追加、feedback データを `calculate_scores()` に渡す |
| `src/lambdas/weight_adjuster/weight_optimizer.py` | ベイズ平滑化、`compute_category_predictive_power()` 追加、最低フィードバック数、EMA ブレンド |
| `terraform/environments/prod/main.tf` | scorer Lambda に `FEEDBACK_TABLE` 環境変数 + DynamoDB Scan 権限追加 |
| `tests/unit/lambdas/test_scorer.py` | 12件追加（category preferences, feedback_bonus, 後方互換性） |
| `tests/unit/lambdas/test_weight_adjuster.py` | 6件追加（ベイズ平滑化、カテゴリ予測力、閾値、EMA） |

## 6. テスト結果

| カテゴリ | テスト数 | 結果 |
|---|---|---|
| Python（pytest） | 67 | 全て PASSED |
| Node.js（node:test） | 66 | 全て PASSED |
| **合計** | **133** | **全て PASSED** |
