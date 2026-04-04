#!/bin/sh
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
node src/summarizer.js
EXIT_CODE=$?

# Claude CLI がトークンを自動リフレッシュした場合、Secrets Manager に書き戻す
# これにより次回の Fargate 起動時に最新のトークンが使える
if [ -n "$CLAUDE_SECRET_ID" ] && [ -f ~/.claude/.credentials.json ]; then
  node -e "
    const fs = require('fs');
    const { SecretsManagerClient, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    (async () => {
      const updated = fs.readFileSync(process.env.HOME + '/.claude/.credentials.json', 'utf8');
      if (updated === process.env.CLAUDE_ACCESS_TOKEN) {
        console.log('[entrypoint] Token unchanged, no sync needed');
        return;
      }
      console.log('[entrypoint] Token was refreshed, syncing to Secrets Manager...');
      const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
      await client.send(new PutSecretValueCommand({
        SecretId: process.env.CLAUDE_SECRET_ID,
        SecretString: updated,
      }));
      console.log('[entrypoint] Secrets Manager updated');
    })().catch(e => console.error('[entrypoint] WARNING: Failed to update Secrets Manager:', e.message));
  "
fi

exit $EXIT_CODE
