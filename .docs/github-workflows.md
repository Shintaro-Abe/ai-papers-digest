# GitHub Workflows ドキュメント

このドキュメントでは、`.github/workflows`ディレクトリに配置されているワークフロー設定について説明します。

## 概要

本リポジトリには以下の2つのGitHub Actionsワークフローが設定されています：

1. **Claude Code** (`claude.yml`) - イシューやPRコメントでClaudeを呼び出すワークフロー
2. **Claude Code Review** (`claude-code-review.yml`) - PRの自動コードレビューを実行するワークフロー

---

## 1. Claude Code (`claude.yml`)

### 目的
イシューやプルリクエストのコメントで `@claude` とメンションすることで、ClaudeがGitHub上で直接タスクを実行できるようにします。

### トリガー条件

以下のGitHubイベントで実行されます：

- `issue_comment.created` - イシューにコメントが作成された時
- `pull_request_review_comment.created` - PRのレビューコメントが作成された時
- `issues.opened` または `issues.assigned` - イシューが開かれた、または割り当てられた時
- `pull_request_review.submitted` - PRレビューが提出された時

### 実行条件

ジョブは以下の条件でのみ実行されます（`if`条件）：

- イシューコメント、PRレビューコメント、PRレビュー本文、またはイシューのタイトル/本文に `@claude` が含まれている場合

### 権限設定

```yaml
permissions:
  contents: read         # リポジトリの内容を読み取り
  pull-requests: read    # プルリクエストを読み取り
  issues: read          # イシューを読み取り
  id-token: write       # IDトークンの書き込み（認証用）
  actions: read         # CI結果の読み取り（PR上のCI結果確認用）
```

### ステップ

1. **Checkout repository** (`actions/checkout@v4`)
   - リポジトリをチェックアウト
   - `fetch-depth: 1` - 最新のコミットのみ取得（高速化）

2. **Run Claude Code** (`anthropics/claude-code-action@v1`)
   - Claudeを実行
   - 必要な認証トークン: `CLAUDE_CODE_OAUTH_TOKEN`（シークレット）
   - 追加権限: `actions: read` - PRのCI結果を読み取る

### カスタマイズオプション（コメントアウト済み）

以下のオプションが利用可能です（必要に応じてコメントを解除）：

```yaml
# prompt: 'Update the pull request description...'
# カスタムプロンプトを指定（デフォルトはコメント内の指示を使用）

# claude_args: '--allowed-tools Bash(gh pr:*)'
# Claudeの動作をカスタマイズ
```

### 設定リファレンス

詳細な設定オプションについては以下を参照：
- [claude-code-action Usage Guide](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)

---

## 2. Claude Code Review (`claude-code-review.yml`)

### 目的
プルリクエストが作成または更新された際に、Claudeによる自動コードレビューを実行します。

### トリガー条件

以下のプルリクエストイベントで実行されます：

- `opened` - PRが新規作成された時
- `synchronize` - PRに新しいコミットがプッシュされた時
- `ready_for_review` - ドラフトPRがレビュー可能になった時
- `reopened` - 閉じられたPRが再オープンされた時

### オプション設定（コメントアウト済み）

#### 1. 特定ファイルのみを対象にする

```yaml
# paths:
#   - "src/**/*.ts"
#   - "src/**/*.tsx"
#   - "src/**/*.js"
#   - "src/**/*.jsx"
```

コメントを解除すると、指定したパスのファイルが変更された場合のみワークフローが実行されます。

#### 2. PR作成者でフィルタリング

```yaml
# if: |
#   github.event.pull_request.user.login == 'external-contributor' ||
#   github.event.pull_request.user.login == 'new-developer' ||
#   github.event.pull_request.author_association == 'FIRST_TIME_CONTRIBUTOR'
```

特定のユーザーまたは初回コントリビューターのPRのみレビューする場合に使用できます。

### 権限設定

```yaml
permissions:
  contents: read         # リポジトリの内容を読み取り
  pull-requests: read    # プルリクエストを読み取り
  issues: read          # イシューを読み取り
  id-token: write       # IDトークンの書き込み（認証用）
```

### ステップ

1. **Checkout repository** (`actions/checkout@v4`)
   - リポジトリをチェックアウト
   - `fetch-depth: 1` - 最新のコミットのみ取得

2. **Run Claude Code Review** (`anthropics/claude-code-action@v1`)
   - Claudeコードレビューを実行
   - 必要な認証トークン: `CLAUDE_CODE_OAUTH_TOKEN`（シークレット）
   - プラグイン設定:
     - `plugin_marketplaces`: Claude Codeのプラグインマーケットプレイス
     - `plugins`: `code-review@claude-code-plugins` - コードレビュープラグイン
   - プロンプト: `/code-review:code-review` コマンドでPRをレビュー

---

## 必要なシークレット設定

両方のワークフローを使用するには、以下のシークレットをGitHubリポジトリに設定する必要があります：

### `CLAUDE_CODE_OAUTH_TOKEN`

- **説明**: Claude Code APIにアクセスするためのOAuth認証トークン
- **設定方法**:
  1. GitHubリポジトリの「Settings」→「Secrets and variables」→「Actions」に移動
  2. 「New repository secret」をクリック
  3. Name: `CLAUDE_CODE_OAUTH_TOKEN`
  4. Value: Anthropicから取得したOAuthトークン
  5. 「Add secret」をクリック

---

## 使用方法

### Claude Codeワークフロー

1. イシューまたはPRで `@claude` とメンションしてコメント
2. 例: `@claude この機能を実装してください`
3. Claudeが自動的にタスクを実行し、結果をコメントで返します

### Claude Code Reviewワークフロー

1. プルリクエストを作成または更新
2. ワークフローが自動的に実行され、Claudeがコードをレビュー
3. レビュー結果がPRコメントとして投稿されます

---

## トラブルシューティング

### ワークフローが実行されない場合

- シークレット `CLAUDE_CODE_OAUTH_TOKEN` が正しく設定されているか確認
- `claude.yml` の場合、コメントに `@claude` が含まれているか確認
- ワークフローファイルの構文エラーがないか確認

### 権限エラーが発生する場合

- リポジトリの「Settings」→「Actions」→「General」で、ワークフローの権限設定を確認
- 必要に応じて「Read and write permissions」を有効化

---

## 参考リンク

- [Claude Code Action リポジトリ](https://github.com/anthropics/claude-code-action)
- [Claude Code Action ドキュメント](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)
- [Claude Code CLI リファレンス](https://code.claude.com/docs/en/cli-reference)
- [GitHub Actions ドキュメント](https://docs.github.com/ja/actions)
