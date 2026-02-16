# セキュリティ + 実装リファクタリング実行計画（2026-02-16）

## 目的
- Timeline 中心の現行実装で、権限境界・秘密情報・API一貫性を改善する。
- 4フェーズで段階的に進め、回帰を抑えながら本番品質へ寄せる。

## フェーズ一覧
1. [Phase 1: 境界防御の即時強化](./phase-1-security-hardening.md)
2. [Phase 2: 権限/秘密情報の設計統一](./phase-2-authz-secrets.md)
3. [Phase 3: API層の実装リファクタ](./phase-3-api-refactor.md)
4. [Phase 4: テスト/監視/運用定着](./phase-4-testing-ops.md)

## 全体チェックリスト
- [x] Phase 1 の完了条件をすべて満たす
- [x] Phase 2 の完了条件をすべて満たす
- [x] Phase 3 の完了条件をすべて満たす
- [x] Phase 4 の完了条件をすべて満たす
- [x] `npm run lint` が通る
- [x] `npm run build` が通る
- [x] `PW_WORKERS=1 npx playwright test --reporter=json > test-results/playwright-report.json` の `.stats.unexpected == 0`
- [x] 変更内容を `docs/` に反映（設計・運用ルール）

## 推奨進行順
1. Phase 1 を先に完了（露出リスクを早期低減）
2. Phase 2 で権限・秘密情報の境界を固定
3. Phase 3 で共通化・型強化を進める
4. Phase 4 で回帰防止と運用定着
