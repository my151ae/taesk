# 0205 アプリ内通知UI強化

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: FE（React/Tailwind）

---

## 🎯 ゴール
- 通知ベル UI を刷新し、未読バッジ・一覧・既読操作をリアルタイムかつアクセシブルに提供する
- コメント/メンション通知（0204）を即時に表示し、オフライン状態でも既存の通知を参照できる
- 将来の通知チャネル（Push）と整合しつつ、アプリ内で完結する UX を実現する

## 📝 背景
- 現在の `NotificationsBell` は単純なドロップダウンで、リアルタイム反映やフィルタリング、アクセシビリティが不足
- 未読数の更新は手動 fetch のみで、通知が多い場合のパフォーマンス課題も顕在化している
- コメント通知ローンチ時に、ユーザーが新着を見逃さない UI が必要

## ✅ スコープ
- `NotificationsBell` をタブ/ドロワー UI に刷新（例えば右サイドパネル）
- Supabase Realtime (`notifications` チャンネル) の購読で新着をストリーミング反映
- 未読・既読の状態管理（`read_at`）と「すべて既読」ボタン
- オフライン時はローカルキャッシュ（IndexedDB or localStorage）から表示
- 通知クリックで関連カードへのディープリンク（暫定: `/b/[short_id]?card=<card_id>`、将来 `/c/...` 復帰）

## 🚫 非スコープ
- Web Push 設定 UI（0206/0208）
- 通知カテゴリ／優先度フィルタ（将来検討）

## 📦 実装タスク
1. **UI/UX デザイン反映**
   - Figma（別途）を基にしたレイアウト（タイトルバー、フィルタ、空状態）
   - ダークモード対応
2. **ステート管理**
   - `NotificationsStore`（Zustand など）を用意し、API/Realtime/ローカルキャッシュを統合
   - 未読件数の selector を用意してベルアイコンに渡す
3. **Realtime 購読**
   - `notifications:recipient_id={user.id}` を購読し、INSERT/UPDATE を反映
   - オフライン検知時は購読を停止し、再接続後に差分同期
4. **既読操作の最適化**
   - 個別既読 (`PATCH /api/notifications/[id]`) は既存実装を活用し、UI から楽観更新
   - まとめて既読は BE で `POST /api/notifications/mark-all-read`（0204終了後に追加）を先に実装してから UI へ組み込む
   - 楽観更新 → 失敗時はロールバック
5. **アクセシビリティ**
   - キーボード操作、`aria-live` で新着を告知、フォーカス管理
6. **ローカルキャッシュ**
   - 最新50件を `localStorage` に保存し、アプリロード時に Hydration
   - バージョニングと破棄戦略を定義

## ✅ 受け入れ基準
- [ ] 新着通知が Realtime 経由で即時にリストへ追加される
- [ ] 未読バッジが正しく増減し、「すべて既読」で 0 になる
- [ ] オフラインでも直前に取得した通知が表示され、オンライン復帰で差分が補完される
- [ ] 通知クリックで対応するカード/ボードへ遷移する
- [ ] WCAG 2.1 AA 基準のアクセシビリティチェックリストを満たす（キーボード操作含む）

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test e2e/phase3-notifications.spec.ts --grep "@inapp" --reporter=json > playwright-report-notifications-ui.json`
  - [ ] `sed -n '/^{/,$p' playwright-report-notifications-ui.json | jq '.stats'`
- [ ] Storybook があればビジュアルリグレッション
- [ ] Realtime: 2ブラウザ手動検証（スクリーン録画）

## 📎 依存関係
- 前提: 0204（通知生成）が完了し、コメント通知が発火すること
- 前提: 0204 完了後に `POST /api/notifications/mark-all-read` を BE 側で実装済みであること
- 後続: 0206（Push購読UI）、0207（Push送信）

## ❓ オープン課題
- 大量通知（>500件）時のページング/検索対応
- モバイルビューでの通知表示（全画面モーダル化するか）
