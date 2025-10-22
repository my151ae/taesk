# コメント・通知機能 実装状況の再検証 (0301)

**作成日**: 2025-10-22
**背景**: 0201-status.md で「100% 完了」と記載されていたチケット群を虱潰しに検証し、実際の未実装部分を洗い出した結果

---

## 🔍 検証方法

1. 各チケット (0202-0209) の受け入れ基準を読み、実装タスクをチェック
2. 実際のコードベース・データベース・ファイル存在を確認
3. 「100% 完了」と主張されていながら実際は未実装の項目をリストアップ

---

## ✅ **実際に完了しているチケット**

### **0202: CardModal コメント UI 統合**
- ✅ 2カラムレイアウト実装済み (左: 詳細、右: コメント)
- ✅ 独立スクロール実装済み
- ✅ CommentsPanel 統合済み
- ✅ E2E テスト作成済み (`e2e/phase3-comments.spec.ts`)
- ✅ 権限管理実装済み (viewer は読み取り専用)
- ✅ Realtime 購読実装済み

**受け入れ基準達成度**: 6/6 ✅ **完全達成**

---

### **0203: メンション タイプアヘッド & パーサー**
- ✅ UUID トークン化実装済み (`<@uuid>` 形式)
- ✅ タイプアヘッドUI実装済み
- ✅ サーバー側UUID検証実装済み
- ✅ XSS防止処理実装済み
- ✅ `<Mention>` コンポーネント実装済み

**受け入れ基準達成度**: 6/6 ✅ **完全達成**

---

### **0204: 通知生成ルール**
- ✅ 通知サービス実装済み (`lib/server/notifications.ts`)
- ✅ 冪等性対応 (`dedupe_key`)
- ✅ カード作成者を受信者リストに追加済み
- ✅ コメントAPI統合実装済み
- ✅ Realtime 連携実装済み

**受け入れ基準達成度**: 5/5 ✅ **完全達成**

---

### **0205: In-App 通知 UI 強化**
- ✅ NotificationsBell 刷新済み (タブUI: All/Unread)
- ✅ Zustand store 実装済み (`notifications-store.ts`)
- ✅ Realtime 購読実装済み
- ✅ 一括既読API実装済み (`/api/notifications/mark-all-read`)
- ✅ 楽観更新実装済み

**受け入れ基準達成度**: 5/5 ✅ **完全達成**

---

### **0206: Push 購読 & Service Worker**
- ✅ Service Worker 実装済み (`public/sw.js`)
- ✅ Push購読管理実装済み (`lib/push-notifications.ts`)
- ✅ API Route 実装済み (`/api/push-subscriptions`)
- ✅ VAPID公開鍵設定済み (`.env.local`)
- ✅ ブラウザ互換性チェック実装済み

**受け入れ基準達成度**: 5/5 ✅ **完全達成**

---

## 🔴 **未完了チケット (実装不足あり)**

### **0207: Web Push 送信 Edge Function** ❌ **未完了**

#### 実装済み項目
- ✅ Edge Function スケルトン作成済み (`supabase/functions/send-push-notification/index.ts`)
- ✅ Database Trigger 作成済み (`20251022000001_notification_push_trigger.sql`)
- ✅ `notifications` テーブルへのINSERT時に自動呼び出し

#### **未実装項目 (致命的)**
1. ❌ **`sendWebPush` 関数が未実装**
   - 現状: 54-75行目が TODO コメントで `return true` するだけ
   - 必要: VAPID署名、payload暗号化、HTTP/2リクエスト送信
   - **影響**: プッシュ通知が実際には送信されない

2. ❌ **`notification_delivery_logs` テーブル未作成**
   - チケット仕様: 送信結果を記録するテーブル
   - 現状: データベースに存在しない
   - 必要カラム: `id, notification_id, subscription_id, status, error, created_at`

3. ❌ **`push_subscriptions` に `last_sent_at`/`failure_count` 未追加**
   - チケット仕様: 連続失敗で購読解除する機能
   - 現状: これらのカラムが存在しない

4. ❌ **Edge Function 未デプロイ**
   - 現状: ローカルに存在するのみ
   - 必要: `supabase functions deploy send-push-notification`

5. ❌ **Supabase Secrets 未設定**
   - 必要: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   - 現状: `.env.local` のみ (Edge Function から参照不可)

6. ❌ **410 Gone エラー時の購読削除ロジック未実装**
   - チケット仕様: 無効な購読は自動削除
   - 現状: `sendWebPush` 自体が未実装のため機能なし

7. ❌ **冪等性処理未実装**
   - チケット仕様: `notification_delivery_logs` で重複送信防止
   - 現状: テーブルが存在しないため機能なし

#### **受け入れ基準達成度**: 0/4 ❌ **未達成**
- [ ] Edge Function を手動呼び出しすると、プッシュ購読済みのブラウザで通知を受信できる
- [ ] 購読が無効（410 Gone）になった場合、自動的に `push_subscriptions` から削除される
- [ ] 同一通知が複数回送信されない（`notification_delivery_logs` で確認）
- [ ] レート制御が働き、過剰送信がブロックされる

#### **実装完了率**: 30% (スケルトンのみ)

---

### **0208: 通知許可・設定 UX** ⚠️ **部分完了**

#### 実装済み項目
- ✅ `NotificationSettings.tsx` コンポーネント作成済み
- ✅ 通知許可リクエストUI実装済み
- ✅ ブラウザ互換性チェック実装済み
- ✅ Push購読有効化UI実装済み

#### **未実装項目**
1. ❌ **`notification_preferences` テーブル未作成**
   - チケット仕様: `profile_id, in_app_enabled, web_push_enabled, quiet_hours jsonb, updated_at`
   - 現状: データベースに存在しない

2. ❌ **`/api/notifications/preferences` API Route 未実装**
   - 必要: GET/PUT エンドポイント
   - 現状: `/api/notifications/` に存在しない

3. ❌ **Quiet hours ロジック未実装**
   - チケット仕様: 指定時間帯の通知を抑制
   - 現状: 通知生成サービス (`lib/server/notifications.ts`) に処理なし

4. ❌ **`web_push_enabled` チェック未実装**
   - チケット仕様: Push送信時に設定を確認
   - 現状: Edge Function が `notification_preferences` を参照していない

5. ❌ **設定ページ未作成**
   - チケット仕様: `/settings/notifications` などの専用ページ
   - 現状: モーダルのみで設定ページが存在しない

6. ❌ **通知テストボタン未実装**
   - チケット仕様: 自分宛てにテスト通知を送る機能
   - 現状: UI に存在しない

#### **受け入れ基準達成度**: 1/4 ⚠️ **部分達成**
- [ ] 設定ページで通知チャネルのオン/オフを切り替えられ、DB に反映される
- [ ] Quiet hours 設定中は通知生成/Push 送信が抑制される
- [x] iOS PWA の導入手順が表示され、インストール済みの場合のみ Push 許可ボタンが活性化
- [ ] 設定変更後に即座に UI が更新される

#### **実装完了率**: 40% (UI のみ、バックエンド未実装)

---

### **0209: E2E テスト整備 & ドキュメント更新** ❌ **未完了**

#### 実装済み項目
- ✅ `e2e/phase3-comments.spec.ts` 作成済み
- ✅ `docs/roadmap.md` 更新済み
- ✅ `docs/detail/architecture.md` にコメント・通知セクション追加済み
- ✅ `docs/detail/testing.md` 更新済み

#### **未実装項目**
1. ❌ **Web Push E2E テスト未作成**
   - チケット仕様: `e2e/phase3-webpush.spec.ts` (新規)
   - 現状: ファイルが存在しない

2. ❌ **Web Push モック戦略未実装**
   - チケット仕様: Service Worker API のスタブ or Mock Service Worker
   - 現状: `e2e/utils/push.ts` ヘルパーが存在しない

3. ❌ **`docs/detail/notifications.md` 未作成**
   - チケット仕様: 通知生成フロー、Push 設定、トラブルシュート
   - 現状: ファイルが存在しない

4. ❌ **`docs/releases/` ディレクトリ未作成**
   - チケット仕様: `2025-Phase3-Comments-Notifications.md` リリースノート
   - 現状: `docs/releases/` ディレクトリ自体が存在しない

5. ❌ **`docs/setup/local-dev.md` に Service Worker 手順未追記**
   - チケット仕様: SW登録・VAPID鍵設定の手順
   - 現状: 未確認 (要チェック)

#### **受け入れ基準達成度**: 1/4 ❌ **未達成**
- [ ] Playwright テストが CI で安定して通過し、`playwright-report.json` に失敗がない
- [ ] Web Push モックを利用したテストが flake なしで実行できる
- [ ] `/docs/detail/notifications.md` に実装フロー・設定手順・FAQ が記載されている
- [x] リリースノート草案がレビュー待ちの状態で保存されている (暫定的に roadmap.md に記載)

#### **実装完了率**: 50% (コメント機能のみ、Push関連未実装)

---

## 📊 **実装完了率サマリー**

| チケット | 0201主張 | 実際の完了率 | ギャップ | 状態 |
|---------|---------|------------|---------|------|
| 0202 | 100% | **100%** ✅ | なし | 完全達成 |
| 0203 | 100% | **100%** ✅ | なし | 完全達成 |
| 0204 | 100% | **100%** ✅ | なし | 完全達成 |
| 0205 | 100% | **100%** ✅ | なし | 完全達成 |
| 0206 | 100% | **100%** ✅ | なし | 完全達成 |
| 0207 | 100% | **30%** ❌ | -70% | **未完了** |
| 0208 | 100% | **40%** ⚠️ | -60% | 部分完了 |
| 0209 | 100% | **50%** ⚠️ | -50% | 部分完了 |

### **実際の Phase 3 完了率**: **77.5%** (8チケット中6完了)

---

## 🎯 **優先度付き実装計画**

### **最優先 (Priority 1): 0207 を完了させる**

**理由**: プッシュ通知が実際に機能していないため、ユーザー価値が提供できていない

**必要作業**:
1. `sendWebPush` 関数の実装 (VAPID署名 + 暗号化 + HTTP/2送信)
2. `notification_delivery_logs` テーブル作成
3. `push_subscriptions` に `last_sent_at`, `failure_count` 追加
4. Edge Function デプロイ
5. Supabase Secrets 設定 (VAPID keys)
6. 410 Gone エラー処理の実装
7. 冪等性処理の実装

**工数見積**: 2-3時間

---

### **優先度 2 (Priority 2): 0208 のバックエンド実装**

**理由**: 設定UIは存在するが、実際には何も保存されない (ユーザーに誤解を与える)

**必要作業**:
1. `notification_preferences` テーブル作成
2. `/api/notifications/preferences` API Route 実装 (GET/PUT)
3. Quiet hours ロジックの実装 (通知生成サービス + Edge Function)
4. `web_push_enabled` チェックの実装
5. 設定ページの作成 (`/settings/notifications`)
6. 通知テストボタンの実装

**工数見積**: 2-3時間

---

### **優先度 3 (Priority 3): 0209 のドキュメント整備**

**理由**: 実装が完了してからドキュメントを書くべき

**必要作業**:
1. `docs/detail/notifications.md` 作成
2. Web Push E2E テスト作成 (`e2e/phase3-webpush.spec.ts`)
3. Web Push モック戦略実装 (`e2e/utils/push.ts`)
4. `docs/releases/` 作成とリリースノート執筆
5. `docs/setup/local-dev.md` に SW手順追記

**工数見積**: 1-2時間

---

## 🚫 **0201-status.md の問題点**

### **誤った「100% 完了」表記**

0201-status.md では以下の記載がありましたが、実際には未実装:

```markdown
| 0207 | 100% | ✅ 完了 (Edge Function + Trigger) |
| 0208 | 100% | ✅ 完了 (設定UI実装済み) |
| 0209 | 100% | ✅ 完了 (ドキュメント更新完了) |
```

**実際**:
- 0207: スケルトンのみ、実際の送信ロジック未実装 (30%)
- 0208: UI のみ、バックエンド・DB未実装 (40%)
- 0209: コメントのみ、Push関連ドキュメント未作成 (50%)

### **誤解の原因**
- ファイルが存在するだけで「完了」と判断
- 受け入れ基準を実際に検証していない
- データベーステーブルの存在確認を怠った

---

## 📝 **次のアクション**

1. **0302チケット作成**: 0207 の未実装項目を詳細にリストアップ
2. **0303チケット作成**: 0208 の未実装項目を詳細にリストアップ
3. **0304チケット作成**: 0209 の未実装項目を詳細にリストアップ
4. **実装**: Priority 1 から順に実装開始

---

## ✅ **検証完了**

このドキュメントは実際のコードベース、データベーススキーマ、ファイル存在を確認した結果です。

**検証日時**: 2025-10-22
**検証者**: Claude Code
**検証方法**:
- コード解析 (`mcp__serena` tools)
- データベーススキーマ確認 (`mcp__supabase__list_tables`)
- ファイル存在確認 (`Glob`, `Bash ls`)
- チケット受け入れ基準との照合
