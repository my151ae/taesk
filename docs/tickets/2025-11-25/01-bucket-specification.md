# A/B バケット新仕様・移行計画

## ゴール
- `due_channel` を廃止し、時間とバケットから自動で配置を決定する。
- バケットキーを `bucket_a` / `bucket_b` に集約し、日付ごとのキー増殖を止める。
- dayKey をマッピング関数で柔軟に決め、Today/Tomorrow 以外（`this_week` など）へもカードを集約できるようにする。
- マイグレーションは一括で実施し、猶予期間を設けない。

## 現状の実装スナップショット（参考）
- バケットキー: `today_a`, `today_b`, `tomorrow_a`, `tomorrow_b`
- `due_channel` で `timeline` / `ab-list` / `list-only` / `archived` を明示的に切り替え。
- API は Today/Tomorrow の2日分のみを返し、A/B 配列も4本固定。

## 確定仕様

### データ構造
```typescript
type Card = {
  id: string;
  title: string;
  description: string;
  // ...既存フィールド

  due_date: string | null;        // ISO日付
  due_start: string | null;       // HH:MM:SS
  due_end: string | null;         // HH:MM:SS

  due_bucket: 'a' | 'b' | null;               // 優先度のみ（必要なら後で 'c' を追加）
  due_bucket_position: number | null;         // 降順でソート

  // due_channel は削除
};
```

### カード配置ロジック
1. `due_start && due_end` がある → タイムライン表示（dayKey はマッピング関数で決定）
2. 上記以外で `due_bucket` がある → A/B リスト表示（dayKey はマッピング関数）
3. `due_date` のみ → サーバー側で強制的に `due_bucket = 'b'` を付与し、A/B リスト表示
4. `due_date` なし → list-only（カンバンのみ）

時間とバケットが両方ある場合は「時間優先」でタイムラインに載せる（バケット情報は保持してよいが表示はタイムライン）。

### dayKey マッピング（柔軟な日付グルーピング）
- `getDayKey(dueDate: string, today: string, mode: 'weekly-7days' | 'relative-buckets' | 'monthly'): string | null` で「日付→グループキー」を決定する。
- 代表パターン:
  - 7日列表示（週ビュー）: dayKey = ISO日付そのもの（例: `2025-11-25`）。各日付リスト/タイムラインにカードを入れる。
  - 相対グループ表示（today/tomorrow/this_week/next_week/this_month/next_month/next_next_month）: 日付が属するレンジに応じてキーを返す。例: diff==0→`today`, diff==1→`tomorrow`, 2-6→`this_week`, 7-13→`next_week`, 14-30→`this_month`/`next_month` など。レンジはボード設定で変更可能にする。
  - 月次グループ（this_month/next_month/next_next_month）: 月境界でキーを決める。
- **集約ビューでの表示**: `this_week` などの集約リストではタイムラインを表示せず、A/B の縦リストで日付降順（新しい日付が上）に並べる。
- A/B 表示も同じ dayKey を使うが、バケット（`a/b`）はカードに保存され、dayKey は保存しない（計算のみ）。
- **重要**: カードデータを書き換えず、レスポンス組み立て時に dayKey を計算してグルーピングする。日付計算は差分計算のみで軽量（O(n)）。

### バケット表示メタデータ
```typescript
export const AB_CARD_META = {
  today:    { title: 'A/B Today',    sections: [{ bucket: 'a', label: 'A: do today', helper: 'Critical' }, { bucket: 'b', label: 'B: if possible', helper: 'Stretch' }] },
  tomorrow: { title: 'A/B Tomorrow', sections: [{ bucket: 'a', label: 'A: do tomorrow', helper: 'Planned' }, { bucket: 'b', label: 'B: if possible', helper: 'Backlog' }] },
  this_week: { title: 'A/B This Week', sections: [...] },
  last_week: { title: 'A/B Last Week', sections: [...] },
  next_month: { title: 'A/B Next Month', sections: [...] },
  // 必要に応じてキーを追加
};
```

### dayKey とバケットの分離
- バケット（`a/b`）はカードに保存する永続フィールド。
- dayKey はビューごとに計算される一時キーで、カードには保存しない。
- これにより、ビュー（7日列表示 / 週・月の集約リスト）を切り替えても、カードの書き換えや全件更新が不要。

### モーダル UI
- フィールドは「日付」「時間（開始/終了）」「バケット（A/B/なし）」の3つに集約。
- `due_channel` 選択 UI は撤廃。
- 日付のみ入力でバケット未指定の場合もサーバー側で自動で B を付与する前提を説明。

### DnD / クライアントロジック
- DnD payload から `due_channel` を除去し、保存時は上記配置ロジックで自動判定。
- バケットへのドロップ時は `due_bucket_position` 未指定なら `Date.now()` を付与。
- タイムラインへのドロップ時は時間優先で表示。

## マイグレーション方針（猶予なし・一括）
1. 新バケットキーへ変換（`a/b`） & `due_channel` 削除
   ```sql
   ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_bucket_new TEXT;

   UPDATE cards
   SET due_bucket_new = CASE
     WHEN due_bucket IN ('today_a', 'tomorrow_a') THEN 'a'
     WHEN due_bucket IN ('today_b', 'tomorrow_b') THEN 'b'
     ELSE due_bucket
   END;

   ALTER TABLE cards DROP COLUMN IF EXISTS due_bucket;
   ALTER TABLE cards RENAME COLUMN due_bucket_new TO due_bucket;

   ALTER TABLE cards DROP COLUMN IF EXISTS due_channel;
   -- チェック制約/enum を `bucket_a` / `bucket_b` に差し替え
   ```
2. API/型/制約を即時更新（後方互換のフォールバックは設けない）。

## API・UI の実装メモ
- API（`/api/boards/[boardId]/timeline`）
  - 取得時に `getDayKey` で dayKey を付与し、イベントとバケットをグルーピングして返す。
  - A/B 配列は `bucket_a/b` の2本を dayKey ごとに保持する構造に切り替える。
- 型（`lib/supabase.ts`, `lib/api-types/timeline.ts`）
  - `due_channel` 削除、`DueBucket` を `bucket_a/b` に変更。
- UI（`CardModal`, Timeline DnD, AB_CARD_META）
  - `due_channel` 関連の state/props を削除し、新ロジックへ統一。

## パフォーマンス/運用の回答
- 日付→dayKey の計算は差分計算のみで軽量。ボード内カード件数に比例する O(n) だが、既存のフェッチ処理と同程度でボトルネックにはなりにくい。
- カードを書き換えず、レスポンス組み立て時にグルーピングするため、ボードごとの一括更新は不要。
- もし大規模ボードで集計が重くなる場合は、計算済み dayKey をキャッシュするカラムを追加する選択肢もあるが、現時点では不要と判断（仕様には含めない）。
