#!/bin/sh
set -e

# CLAUDE_ACCESS_TOKEN 環境変数から ~/.claude/.credentials.json を動的生成
if [ -n "$CLAUDE_ACCESS_TOKEN" ]; then
  mkdir -p ~/.claude
  echo "$CLAUDE_ACCESS_TOKEN" > ~/.claude/.credentials.json
  echo "[entrypoint] Claude credentials configured"
else
  echo "[entrypoint] WARNING: CLAUDE_ACCESS_TOKEN not set"
fi

# トークンリフレッシュを事前に実行（要約生成前にリフレッシュを確保）
# claude auth status を実行すると、期限切れ時に自動リフレッシュが走る
echo "[entrypoint] Checking auth status (triggers refresh if needed)..."
claude auth status --output json 2>/dev/null || echo "[entrypoint] WARNING: auth status check failed"

# リフレッシュ後のトークンを Secrets Manager に書き戻し（要約前に実施）
if [ -n "$CLAUDE_SECRET_ID" ] && [ -f ~/.claude/.credentials.json ]; then
  node -e "
    const fs = require('fs');
    const { SecretsManagerClient, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    (async () => {
      const updated = fs.readFileSync(process.env.HOME + '/.claude/.credentials.json', 'utf8');
      if (updated === process.env.CLAUDE_ACCESS_TOKEN) {
        console.log('[entrypoint] Token unchanged after auth check');
        return;
      }
      console.log('[entrypoint] Token was refreshed, syncing to Secrets Manager...');
      const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
      await client.send(new PutSecretValueCommand({
        SecretId: process.env.CLAUDE_SECRET_ID,
        SecretString: updated,
      }));
      console.log('[entrypoint] Secrets Manager updated (pre-run)');
    })().catch(e => console.error('[entrypoint] WARNING: Failed to sync:', e.message));
  "
fi

# メインアプリケーション起動
node src/summarizer.js
EXIT_CODE=$?

# 実行後にも再度書き戻し（summarizer 実行中にリフレッシュされた場合）
if [ -n "$CLAUDE_SECRET_ID" ] && [ -f ~/.claude/.credentials.json ]; then
  node -e "
    const fs = require('fs');
    const { SecretsManagerClient, PutSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    (async () => {
      const updated = fs.readFileSync(process.env.HOME + '/.claude/.credentials.json', 'utf8');
      if (updated === process.env.CLAUDE_ACCESS_TOKEN) {
        console.log('[entrypoint] Token unchanged after run');
        return;
      }
      console.log('[entrypoint] Token refreshed during run, syncing to Secrets Manager...');
      const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'ap-northeast-1' });
      await client.send(new PutSecretValueCommand({
        SecretId: process.env.CLAUDE_SECRET_ID,
        SecretString: updated,
      }));
      console.log('[entrypoint] Secrets Manager updated (post-run)');
    })().catch(e => console.error('[entrypoint] WARNING: Failed to sync:', e.message));
  "
fi

exit $EXIT_CODE
