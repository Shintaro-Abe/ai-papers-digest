#!/bin/sh
set -e

# API キーが混入していると Agent SDK がサブスク認証より優先してしまうため除去する。
unset ANTHROPIC_API_KEY

# 認証は CLAUDE_CODE_OAUTH_TOKEN（claude setup-token で生成した約1年有効のトークン）。
# ECS タスク定義の secrets で env 注入済み。Agent SDK がこの env を直接読むため、
# 旧方式の .credentials.json 生成・auth status リフレッシュ・Secrets Manager 書き戻しは不要。
if [ -z "$CLAUDE_CODE_OAUTH_TOKEN" ]; then
  echo "[entrypoint] WARNING: CLAUDE_CODE_OAUTH_TOKEN not set — Agent SDK auth will fail"
else
  echo "[entrypoint] CLAUDE_CODE_OAUTH_TOKEN present"
fi

# メインアプリケーション起動
node src/summarizer.js
