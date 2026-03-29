#!/bin/bash
set -e

# CLAUDE_ACCESS_TOKEN 環境変数から ~/.claude/.credentials.json を動的生成
# CLAUDE_ACCESS_TOKEN には credentials.json の全体 JSON が格納されている想定
if [ -n "$CLAUDE_ACCESS_TOKEN" ]; then
  mkdir -p ~/.claude
  echo "$CLAUDE_ACCESS_TOKEN" > ~/.claude/.credentials.json
  echo "[entrypoint] Claude credentials configured"
else
  echo "[entrypoint] WARNING: CLAUDE_ACCESS_TOKEN not set"
fi

# メインアプリケーション起動
exec node src/summarizer.js
