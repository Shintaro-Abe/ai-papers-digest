# フィードバック学習システム改修 — タスクリスト

## 実装 ✅ 完了

- [x] scoring.py: feedback_bonus 計算（カテゴリベース + Laplace 平滑化）
- [x] scoring.py: `w4 * 0.0` → `w4 * normalize(feedback_bonus)` に修正
- [x] handler.py: `_get_recent_feedback()` 追加、feedback データを scoring に渡す
- [x] weight_optimizer.py: ベイズ平滑化を `compute_predictive_power()` に追加
- [x] weight_optimizer.py: `compute_category_predictive_power()` 新規追加（w4 最適化用）
- [x] weight_optimizer.py: 最低フィードバック数（5件）チェック追加
- [x] weight_optimizer.py: EMA ブレンド（learning_rate=0.3）追加
- [x] Terraform: scorer Lambda に `FEEDBACK_TABLE` 環境変数 + IAM 権限追加
- [x] Terraform apply 実行済み

## テスト ✅ 完了

- [x] test_scorer.py: category preferences テスト（5件）
- [x] test_scorer.py: feedback_bonus テスト（4件）
- [x] test_scorer.py: calculate_scores with/without feedback テスト（2件）
- [x] test_scorer.py: 既存テスト後方互換性確認（1件）
- [x] test_weight_adjuster.py: ベイズ平滑化テスト（1件）
- [x] test_weight_adjuster.py: カテゴリ予測力テスト（3件）
- [x] test_weight_adjuster.py: 最低フィードバック数テスト（1件）
- [x] test_weight_adjuster.py: EMA ブレンドテスト（1件）
- [x] 全133件 PASSED 確認済み

## デプロイ ✅ 完了

- [x] コミット・プッシュ（9614ef6）
- [x] deploy workflow 成功（Lambda デプロイ + CodeBuild）
- [x] Terraform apply（scorer IAM + 環境変数）
