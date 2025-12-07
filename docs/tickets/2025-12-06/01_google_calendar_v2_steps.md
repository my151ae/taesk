# Googleカレンダー連携 v2 実装ステップ（Taesk→Google 書き込み）

## v2 概要
- **目的**: 「Google連携ON」のカードだけ Google 予定を作成・更新・削除。Taesk→Google の単方向書き込み。
- **スコープ追加**: `calendar.events`（読み書き）
- **主な技術**: v1 に加え、`calendar_sync` テーブルで紐付け管理 / `extendedProperties.private` に card ID などを埋め込み / 冪等な同期API。

---

## ステップ1: スコープ拡張と再認可フロー
- [ ] OAuth スコープを `calendar.readonly` → `calendar.events` に変更
- [ ] 認可URLに `access_type=offline`, `include_granted_scopes=true`, `prompt=consent` を確実に付与
- [ ] `google_calendar_accounts.scope` カラムで**実際の付与済みスコープ**を保存
- [ ] 既存ユーザーには再認可を促す仕組み（バナー or 自動リダイレクト）
- [ ] 401/`invalid_grant`（リフレッシュトークン失効）時の再接続動線を明記

### 必須決定事項
- 再認可フローは `/api/integrations/google-calendar/connect` を再利用
- 書き込み権限が無い場合、v2 機能（sync）は無効化しつつ v1（読み取り）は維持
- スコープ不足時は同期トグルを無効化＋再認可導線を表示

---

## ステップ2: `calendar_sync` テーブル作成

### スキーマ（最終版）
```sql
CREATE TABLE calendar_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  google_account_id UUID NOT NULL REFERENCES google_calendar_accounts(id) ON DELETE CASCADE,
  google_event_id TEXT,              -- NULL許可（作成後に埋まる）
  calendar_id TEXT NOT NULL,         -- 実ID保存（'primary'エイリアスではなく）
  etag TEXT,                         -- 楽観ロック用（GoogleイベントのETag）
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'unlinked' | 'deleted'
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, google_account_id)
);

CREATE INDEX idx_calendar_sync_card ON calendar_sync(card_id);
CREATE INDEX idx_calendar_sync_account ON calendar_sync(google_account_id);
```

### FK削除時の挙動
- `card_id` → `ON DELETE CASCADE`: カード削除で同期レコードも削除
- `google_account_id` → `ON DELETE CASCADE`: アカウント切断で同期レコードも削除（再接続時に再作成）

### 設計ポイント
- **UNIQUE制約**: `(card_id, google_account_id)` — 多アカウント対応
- **google_event_id**: 作成前は未確定なので NULL 許可
- **calendar_id**: 実IDを保存（将来のカレンダー切替に対応）
- **etag**: 競合検出・楽観ロック用
- **status**: `active`/`unlinked`/`deleted` で状態管理

### 既存データ移行方針
- `cards.google_sync_enabled = true` のカードは `calendar_sync.status = 'active'` として移行
- 移行後、`cards.google_sync_enabled` カラムは凍結（削除検討）

---

## ステップ3: 書き込み API 実装

### 内部API設計
| エンドポイント | メソッド | 説明 | ヘッダ |
|---|---|---|---|
| `/api/calendar-sync/:cardId` | POST | 同期有効化＆作成（冪等） | `Idempotency-Key`（推奨） |
| `/api/calendar-sync/:cardId` | PATCH | カード更新時にGoogle予定を更新 | `Idempotency-Key`（必須） |
| `/api/calendar-sync/:cardId` | DELETE | 無効化（unlink or delete の選択） | `Idempotency-Key`（推奨） |

### リクエスト仕様
- **POST**: `google_account_id`, `calendar_id`（省略時は既定）
- **PATCH**: 差分更新
- **DELETE**: `?mode=unlink` or `?mode=delete` で挙動選択

### Google API 呼び出しオプション
- **`sendUpdates='none'`**: メール通知抑制（既定）
- **`quotaUser`**: ユーザー単位でクォータ分離（ヘビーユース対策）

### `extendedProperties.private` 埋め込み
```json
{
  "taeskCardId": "<card_id>",
  "taeskUpdatedAt": "<ISO8601>"
}
```

### 冪等化ロジック（重複回避）
1. 作成前に `events.list`（`privateExtendedProperty=taeskCardId=...`, `maxResults=1`）で既存検索
2. **複数ヒット時**: `updated` が最新のものを採用
3. 存在すれば **PATCH**（更新）に切替
4. 無ければ **INSERT**（作成）

### 再作成ルール
- `status='active' && google_event_id IS NULL` の場合 → 冪等検索後に `events.insert`

### タイムゾーン対策
- イベント POST 時に `dateTime` と `timeZone` を**明示**
- 既定: `Asia/Tokyo`（将来はボード/ユーザー設定で変更可能）
- **優先順位**: イベント payload の `timeZone` を最優先
- 可能なら接続時に `calendars.get` でユーザーのデフォTZを保存

### 仕様の明確化
- **終日イベント**: 非対応（`due_start`/`due_end` 必須）
- **DST/TZ**: payload の `timeZone` を最優先、保存TZ ≠ カレンダーTZ でも payload の値で上書き

---

## ステップ4: エラーハンドリング拡充

### 対応すべきエラー
| コード | 説明 | 対応 |
|---|---|---|
| 401 | 認証切れ | 再認可誘導 |
| 403 | 権限不足 | スコープ再確認、再認可誘導 |
| 404 | イベント削除済み/移動済み | 全カレンダー検索→再リンク or 再作成 |
| 409 | 競合 | etag 再取得→再適用 |
| 410 Gone | リソース完全削除 | `calendar_sync` をクリア→再作成 |
| **412** | **If-Match 不一致（ETag競合）** | **etag 再取得→再適用** |
| 429 | レート制限 | 指数バックオフ＋ジッタで再試行 |
| 5xx | サーバーエラー | 指数バックオフで再試行 |

### 404 リカバリ方針
1. 同じ `taeskCardId` で**全カレンダー検索**（`maxResults=1`）
2. 見つかれば `calendar_id`/`google_event_id`/`etag` を更新
3. 見つからなければ再作成

### 再試行ポリシー
- 指数関数バックオフ（1s, 2s, 4s, ...）＋ランダムジッタ
- 最大再試行回数: 5回
- DLQ（Dead Letter Queue）: 失敗した同期を保留→後で再試行

### エラーレスポンス形式
```json
{
  "error": {
    "code": "GOOGLE_RATE_LIMIT",
    "message": "Google APIのレート制限に達しました。しばらくしてから再試行してください。",
    "retryable": true
  }
}
```

---

## ステップ5: 同期トリガーとフロー

### 同期フロー
1. カード保存 → 内部API呼び出し
2. `calendar_sync` レコード確認（対象アカウント）
3. `status === 'active'` なら Google Calendar API 呼び出し
4. 作成: `events.insert` → `google_event_id`, `etag` 保存
5. 更新: `events.patch`（`If-Match: etag`）→ 楽観ロック
6. `last_synced_at` 更新

### トグルOFF時の挙動
- **unlink**: `status = 'unlinked'`、`google_event_id` は保持（再有効化時に再利用）
- **delete**: Google イベント削除 + `status = 'deleted'`

### カード削除時
- `calendar_sync.status === 'active'` なら Google 予定も削除
- `calendar_sync` レコードは CASCADE で自動削除

---

## ステップ6: 入力バリデーション

- [ ] `due_start < due_end` チェック
- [ ] 最小会議長: 5〜15分（設定可能）
- [ ] 日付のみ（終日）の場合は非対応メッセージ
- [ ] サマリ/説明の文字数制限（Google側制限に合わせてカット）
- [ ] `extendedProperties` の長さ制限

---

## ステップ7: UI 統合

### カード編集モーダル
- [ ] 「Googleカレンダーに同期する」トグル追加
- [ ] 権限不足時はトグル無効化＋再認可リンク表示
- [ ] 同期状態インジケーター（同期中 🔄 / 同期済み ✅ / エラー ⚠️）

### タイムラインカード
- [ ] 同期済みカードに「G」アイコン表示（v1 の読み取り専用と差別化）
- [ ] エラー時は「再試行」「再接続」ボタン表示

### 再試行/再接続導線
- [ ] 同期失敗時のカード上アクションボタン
- [ ] トースト通知でエラー内容を表示

---

## ステップ8: 観測性（Observability）

### メトリクス
- 成功/失敗数（エンドポイント別）
- 失敗コード別カウント（401/403/404/409/412/429/5xx）
- 再試行回数
- 平均/最大レイテンシ

### ログ
- `Idempotency-Key`
- `taeskCardId`
- `google_account_id`
- HTTP ステータス
- **注意**: PII（トークン、イベント本文）はログに出さない

### アラート
- 連続 5xx（5回以上）
- 429 の急増（1分間に10回以上）
- 同期遅延（`last_synced_at` が30分以上前）

---

## ステップ9: テスト観点

### 基本フロー
- [ ] カード作成 → Google 予定が作成されること
- [ ] カード更新（時間変更）→ Google 予定が更新されること
- [ ] カード削除 → Google 予定が削除されること
- [ ] `extendedProperties.private.taeskCardId` が正しく設定されていること

### エッジケース
- [ ] 権限取り消し → 再接続導線が表示されること
- [ ] リトライで重複しない（冪等性）
- [ ] トグルOFF → unlink/delete の挙動確認
- [ ] 多アカウント/別カレンダーへの切替
- [ ] DST/他TZの端境（サマータイム地域での検証）

### 競合・リカバリテスト
- [ ] 412（If-Match 不一致）→ 再取得→再適用
- [ ] 404 → 全カレンダー検索 → 再リンク or 再作成
- [ ] 同一カードに対する**同時二重送信（POST/DELETE）**→ Idempotency-Key で収束
- [ ] アカウント切断（FK CASCADE）→ 再接続で復旧できるか

---

## 追加メモ（v3 を見据えた種まき）
- `extendedProperties.private.taeskUpdatedAt` を設定 → v3 の差分判定で活用
- `syncToken` の取得・保存は v3 で実装
- Description にカードの Deep Link を入れる（ユーザー回遊性向上）
- ログ/PII 方針: `access_token`/`refresh_token` や生イベント本文はログに出さない

---

## 実装順序（推奨）
1. ステップ2: DB マイグレーション（`calendar_sync`）＋既存データ移行
2. ステップ1: スコープ拡張・再認可フロー
3. ステップ3: 書き込み API スケルトン
4. ステップ4: エラーハンドリング・再試行ロジック
5. ステップ5: 同期トリガー実装
6. ステップ6: 入力バリデーション
7. ステップ7: UI 統合
8. ステップ8: 観測性（メトリクス・ログ・アラート）
9. ステップ9: テスト

