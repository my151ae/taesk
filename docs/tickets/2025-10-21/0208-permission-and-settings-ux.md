# 0208 通知許可・設定UX

**作成日**: 2025-10-20
**関連エピック**: `docs/tickets/2025-10-20/0200-comments-notifications-epic.md`
**担当候補**: FE（UX） + BE（設定API）

---

## 🎯 ゴール
- ユーザーが通知チャネル（In-App / Web Push）を自分で管理できる設定画面を提供する
- Quiet hours（おやすみ時間）や通知オン/オフを設定し、通知生成/送信ロジックと連動させる
- iOS PWA 導入導線を用意し、Web Push 許可手順をガイド化する

## 📝 背景
- 通知機能のローンチ時に、ユーザー側で制御できる仕組みが無いと過剰通知につながる
- `notification_preferences` テーブルを利用して、チャンネル別の有効/無効や quiet hours を保存する想定
- iOS Safari での Web Push は PWA インストールが前提のため、設定画面で手順を案内する必要がある

## ✅ スコープ
- 設定ページ（`/settings/notifications` など）を追加し、通知チャネル・Quiet hours・サマリーを表示
- `notification_preferences` テーブルの CRUD API を実装（GET/PUT）
- Quiet hours に基づき通知生成サービス（0204）と Push 送信（0207）で抑制ロジックを適用
- iOS / Android / Desktop 向けのガイドモーダルを実装（A2HS、OS通知設定リンク）

## 🚫 非スコープ
- 組織/ボード単位の通知設定（将来検討）
- メール通知

## 📦 実装タスク
1. **データモデル整備**
   - `notification_preferences(profile_id primary key, in_app_enabled boolean default true, web_push_enabled boolean default false, quiet_hours jsonb, updated_at timestamptz)` を確認/追加
   - Quiet hours は `{ start: '22:00', end: '07:00', timezone: 'Asia/Tokyo' }` 形式
2. **API Routes**
   - `GET /api/notifications/preferences`（現状の設定取得）
   - `PUT /api/notifications/preferences`（更新、バリデーション含む）
   - RLS: 自分のレコードのみ
3. **設定ページ UI**
   - トグルスイッチ（In-App / Web Push）
   - Quiet hours 入力（Time picker + Timezone selector）
   - iOS PWA ガイド：ステップカード/動画リンク
   - 通知テストボタン（自分宛てにテスト通知を送る Edge Function 呼び出し）
4. **ロジック連携**
   - 0204 通知生成で quiet hours 中の場合は `snoozed_at` フラグを立てる or 通知作成をスキップ
   - 0207 Push 送信時に `web_push_enabled` を確認
5. **UX/アクセシビリティ**
   - 設定変更時にトーストで結果を通知
   - キーボード操作、スクリーンリーダー対応

## ✅ 受け入れ基準
- [ ] 設定ページで通知チャネルのオン/オフを切り替えられ、DB に反映される
- [ ] Quiet hours 設定中は通知生成/Push 送信が抑制される（テスト通知で確認）
- [ ] iOS PWA の導入手順が表示され、インストール済みの場合のみ Push 許可ボタンが活性化
- [ ] 設定変更後に即座に UI が更新される（Optimistic Update）

## 🧪 テスト
- [ ] `npm run lint`
- [ ] `npx playwright test e2e/phase3-notifications.spec.ts --grep "@settings" --reporter=json > playwright-report-notifications-settings.json`
  - [ ] `sed -n '/^{/,$p' playwright-report-notifications-settings.json | jq '.stats'`
- [ ] API 単体テスト（`app/api/notifications/preferences/route.test.ts`）
- [ ] Quiet hours ロジックのユニットテスト（通知生成サービス）

## 📎 依存関係
- 前提: 0205（UI基盤）、0206/0207（Push購読/送信）
- 後続: 0209（ドキュメント更新）

## ❓ オープン課題
- Quiet hours のタイムゾーン管理（プロフィール設定と統合するか）
- `snoozed` 通知をいつ再送するか（再キューイング戦略）

