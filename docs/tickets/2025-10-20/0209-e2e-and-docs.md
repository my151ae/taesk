# 0209 E2Eテスト整備 & ドキュメント更新

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: QA/FE + ドキュメント担当

---

## 🎯 ゴール
- コメント・通知・Web Push に関する E2E シナリオを Playwright に追加/更新し、CI 上で安定して実行できるようにする
- 新機能に伴う開発者向けドキュメント（setup/制約/トラブルシュート）を `/docs` 配下へ追記する
- ローンチ後の運用手順・既知の制約をまとめ、サポートメンバーが参照できる状態にする

## 📝 背景
- Phase3 の既存 E2E (`phase3-comments.spec.ts`, `phase3-notifications.spec.ts`) を拡張し、メンション・Push 等の新ケースをカバーする必要がある
- Web Push は本番同等の挙動を再現しづらいため、モック/スタブ戦略をドキュメント化する
- 開発者が環境構築やテスト手順で迷わないよう、`docs/detail/` への追記が必要

## ✅ スコープ
- Playwright テストの追加/改修（コメント・通知・Push各シナリオ）
- テストデータ作成/クリーンアップのヘルパー調整（`e2e/utils/board.ts` 等）
- Web Push のモック戦略（Service Worker API のスタブ or Mock Service Worker）を整備
- `docs/detail/notifications.md`（新規）の作成、および既存 `docs/detail/architecture.md` の更新
- リリースノート草案の追記（`docs/releases/`）

## 🚫 非スコープ
- 実装コード修正（他チケットで完了している前提）
- サポートチームへのトレーニング資料（別途）

## 📦 実装タスク
1. **Playwright テスト整備**
   - `e2e/phase3-comments.spec.ts`：メンション作成/編集/削除、Realtime 反映チェック
   - `e2e/phase3-comments.spec.ts`：暫定モーダル経路（`/b/[short_id]?card=`）での直接アクセス・リロードを検証
   - `e2e/phase3-notifications.spec.ts`：通知生成→UI反映→既読処理、Quiet hours、設定変更
   - `e2e/phase3-webpush.spec.ts`（新規）：Service Worker モック経由で Push 受信フローを検証
   - テスト用フラグ/環境変数の整理（`PLAYWRIGHT_WEBPUSH_STUB=1` 等）
2. **CI 安定化**
   - テストごとの `beforeEach` でテストボード作成→`afterEach` で削除
   - Web Push モックのためのヘルパーを `e2e/utils/push.ts` に作成
3. **開発者ドキュメント更新**
   - `docs/detail/notifications.md`：通知生成フロー、Push 設定、トラブルシュート（iOS PWA など）
   - `docs/setup/local-dev.md` に Service Worker 登録・VAPID 鍵設定手順を追記
   - `docs/tickets/2025-10-20/0200-comments-notifications-epic.md` へのリンク/進捗表を更新
   - 暫定カードモーダル仕様（`?card=`）を `docs/detail/architecture.md` へ追記し、復帰条件を明文化
4. **リリースノート草案**
   - `docs/releases/2025-Phase3-Comments-Notifications.md`（仮）にハイライト・既知の制約・ロールアウト手順をまとめる

## ✅ 受け入れ基準
- [ ] Playwright テストが CI で安定して通過し、`playwright-report.json` に失敗がない
- [ ] Web Push モックを利用したテストが flake なしで実行できる
- [ ] `/docs/detail/notifications.md` に実装フロー・設定手順・FAQ が記載されている
- [ ] リリースノート草案がレビュー待ちの状態で保存されている

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test --reporter=json > playwright-report-phase3.json`
  - [ ] `sed -n '/^{/,$p' playwright-report-phase3.json | jq '.stats'`
- [ ] CI（GitHub Actions or Vercel）での実行ログ確認

## 📎 依存関係
- 前提: 0201〜0208 が完了し、機能が揃っていること
- 後続: 本番リリース、サポートチーム展開

## ❓ オープン課題
- Web Push モックをどのレイヤーで提供するか（Service Worker スタブ vs Supabase Edge Function の stub）
- iOS デバイスでの自動テスト戦略（現状は手動検証のみ）
