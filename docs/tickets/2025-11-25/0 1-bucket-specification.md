# A/Bバケット仕様整理

## 現在の実装

### 1. バケットの構造

**バケットキー**: `today_a`, `today_b`, `tomorrow_a`, `tomorrow_b`

```typescript
// timeline-helpers.ts
export const AB_CARD_META = {
    today: {
        title: 'A/B Today',
        sections: [
            { bucket: 'today_a', label: 'A: do today (not scheduled)', helper: 'Critical tasks' },
            { bucket: 'today_b', label: 'B: if possible today', helper: 'Stretch tasks' },
        ],
    },
    tomorrow: {
        title: 'A/B Tomorrow',
        sections: [
            { bucket: 'tomorrow_a', label: 'A: do tomorrow', helper: 'Planned focus' },
            { bucket: 'tomorrow_b', label: 'B: if possible tomorrow', helper: 'Backlog' },
        ],
    },
};
```

**データ構造**:
- `due_channel`: `'ab-list'` または `'timeline'`
- `due_bucket`: `'today_a'` | `'today_b'` | `'tomorrow_a'` | `'tomorrow_b'` | null
- `due_date`: 日付（ISO形式の文字列）
- `due_start`: 開始時刻（HH:MM形式）
- `due_end`: 終了時刻（HH:MM形式）
- `due_bucket_position`: バケット内での並び順

### 2. カードの配置ロジック

**現在の配置ルール**:
1. **タイムラインに表示**: `due_channel === 'timeline'` かつ `due_start` と `due_end` が設定されている
2. **A/Bリストに表示**: `due_channel === 'ab-list'` かつ `due_bucket` が設定されている

**問題点**:
- A/Bバケットは日付（today/tomorrow）と優先度（A/B）の組み合わせで固定されている
- 時間が設定されてもA/Bリストに入れることができない
- 日付の種類を増やす（3日後、今週など）場合、バケットキーが爆発的に増える

---

## 新しい仕様

### 1. 基本コンセプト

**カードの配置は3つの要素で決定**:
1. **日付** (`due_date`): どの日に表示するか
2. **時間** (`due_start`, `due_end`): タイムラインに表示するか、A/Bリストに表示するか
3. **バケット** (`due_bucket`): A/Bリストのどこに表示するか

### 2. 配置ルール

```
if (due_start && due_end) {
    → タイムラインに表示（due_dateの列に）
} else if (due_bucket) {
    → A/Bリストに表示（due_dateに対応するリストの、due_bucketセクションに）
} else {
    → リストのみ（カンバン）
}
```

### 3. バケットの再設計

**バケットキーを優先度のみに**:
- `bucket_a`: 高優先度（Critical tasks / Planned focus）
- `bucket_b`: 低優先度（Stretch tasks / Backlog）

**日付との関連付け**:
- `due_date`の値に基づいて、表示するA/Bリストを決定
- 例：`due_date === '2025-11-25'` → "Today"のA/Bリスト
- 例：`due_date === '2025-11-26'` → "Tomorrow"のA/Bリスト

### 4. データ構造（新）

```typescript
type Card = {
    // 既存フィールド
    id: string;
    title: string;
    // ...
    
    // 日付・時間関連
    due_date: string | null;        // ISO形式の日付（例: '2025-11-25'）
    due_start: string | null;       // HH:MM形式（例: '09:00'）
    due_end: string | null;         // HH:MM形式（例: '10:00'）
    
    // バケット関連
    due_bucket: 'bucket_a' | 'bucket_b' | null;  // A or B（優先度のみ）
    due_bucket_position: number | null;          // バケット内の並び順
    
    // チャンネル（後方互換性のため残す？）
    due_channel: 'timeline' | 'ab-list' | 'list-only';
};
```

### 5. モーダルのUI

**フォーム構成**:
```
┌─────────────────────────────────┐
│ 日付: [2025-11-25 ▼]           │
│                                 │
│ 時間: [09:00] - [10:00]        │
│       [クリア]                  │
│                                 │
│ バケット: [ ] A (高優先度)      │
│          [ ] B (低優先度)       │
│          [x] なし              │
└─────────────────────────────────┘
```

**動作**:
- 時間が設定されている → タイムラインに表示
- 時間がなく、バケットが選択されている → A/Bリストに表示
- どちらもない → リストのみ（カンバン）

### 6. 拡張性

**将来的な日付の追加**:
- "3日後"、"今週"、"来週"などを追加する場合、`AB_CARD_META`に新しいキーを追加するだけでOK
- バケットキーは`bucket_a`/`bucket_b`のまま変わらない

```typescript
export const AB_CARD_META = {
    today: { ... },
    tomorrow: { ... },
    in_3_days: {
        title: 'A/B 3日後',
        sections: [
            { bucket: 'bucket_a', label: 'A: 3日後優先', helper: '...' },
            { bucket: 'bucket_b', label: 'B: 3日後検討', helper: '...' },
        ],
    },
    this_week: {
        title: 'A/B 今週',
        sections: [
            { bucket: 'bucket_a', label: 'A: 今週優先', helper: '...' },
            { bucket: 'bucket_b', label: 'B: 今週検討', helper: '...' },
        ],
    },
};
```

**日付とキーのマッピング関数**:
```typescript
function getTimelineDayKey(dueDate: string, today: string): string {
    const dayDiff = calculateDayDiff(dueDate, today);
    
    if (dayDiff === 0) return 'today';
    if (dayDiff === 1) return 'tomorrow';
    if (dayDiff === 2) return 'in_3_days';
    if (dayDiff >= 3 && dayDiff < 7) return 'this_week';
    
    return 'future'; // またはnull
}
```

---

## 移行計画

### フェーズ1: データ構造の変更
1. `due_bucket`を `'bucket_a'` | `'bucket_b'` に変更
2. 既存データのマイグレーション
   - `today_a` → `bucket_a` (due_date = today)
   - `today_b` → `bucket_b` (due_date = today)
   - `tomorrow_a` → `bucket_a` (due_date = tomorrow)
   - `tomorrow_b` → `bucket_b` (due_date = tomorrow)

### フェーズ2: UIの変更
1. CardModalのフォームを3つのフィールドに更新
2. ドラッグ&ドロップロジックの更新

### フェーズ3: 日付の拡張
1. `AB_CARD_META`に新しい日付キーを追加
2. タイムラインの日付計算ロジックを更新

---

## 確定仕様

### 1. due_channelの扱い
**決定**: **削除**

- `due_channel`フィールドは削除します
- カードの配置は時間とバケットの有無から自動的に判定します
- 判定ロジック:
  ```typescript
  function getCardPlacement(card: Card): 'timeline' | 'bucket' | 'list-only' {
      if (card.due_start && card.due_end) {
          return 'timeline';
      } else if (card.due_bucket) {
          return 'bucket';
      } else {
          return 'list-only';
      }
  }
  ```

### 2. バケットなし + 時間なしのカード
**決定**: **デフォルトでbucket_b**

- 日付のみ設定され、時間もバケットも設定されていないカードは、自動的に`bucket_b`（低優先度）に配置されます
- これにより、すべての日付付きカードがA/Bリストに表示されます

### 3. 時間とバケットの両方が設定されている場合
**決定**: **時間優先（タイムラインに表示）**

- 時間が設定されている場合は、バケットの設定に関わらずタイムラインに表示します
- より具体的な予定（時間指定）を優先的に表示する仕様です

### 4. マイグレーションのタイミング
**決定**: **一括マイグレーション（SQL）**

- 既存データは一括SQLマイグレーションで変換します
- マイグレーションスクリプト:
  ```sql
  -- Step 1: Add new bucket column (if not exists)
  ALTER TABLE cards ADD COLUMN IF NOT EXISTS due_bucket_new TEXT;
  
  -- Step 2: Migrate data
  UPDATE cards
  SET due_bucket_new = CASE
      WHEN due_bucket IN ('today_a', 'tomorrow_a') THEN 'bucket_a'
      WHEN due_bucket IN ('today_b', 'tomorrow_b') THEN 'bucket_b'
      ELSE due_bucket
  END
  WHERE due_bucket IS NOT NULL;
  
  -- Step 3: Drop old column and rename new one
  ALTER TABLE cards DROP COLUMN due_bucket;
  ALTER TABLE cards RENAME COLUMN due_bucket_new TO due_bucket;
  
  -- Step 4: Remove due_channel column
  ALTER TABLE cards DROP COLUMN IF EXISTS due_channel;
  ```

---

## 最終データ構造

```typescript
type Card = {
    // 既存フィールド
    id: string;
    title: string;
    description: string;
    // ...
    
    // 日付・時間関連
    due_date: string | null;        // ISO形式の日付（例: '2025-11-25'）
    due_start: string | null;       // HH:MM形式（例: '09:00'）
    due_end: string | null;         // HH:MM形式（例: '10:00'）
    
    // バケット関連
    due_bucket: 'bucket_a' | 'bucket_b' | null;  // A or B（優先度のみ）
    due_bucket_position: number | null;          // バケット内の並び順
    
    // ※ due_channelは削除
};
```

## カード配置ロジック（確定版）

```typescript
function placeCard(card: Card, today: string): CardPlacement {
    // 1. 時間が設定されている → タイムライン
    if (card.due_start && card.due_end) {
        return {
            type: 'timeline',
            dayKey: getTimelineDayKey(card.due_date, today),
        };
    }
    
    // 2. バケットが設定されている → A/Bリスト
    if (card.due_bucket) {
        return {
            type: 'bucket',
            dayKey: getTimelineDayKey(card.due_date, today),
            bucket: card.due_bucket,
        };
    }
    
    // 3. 日付のみ設定 → デフォルトでbucket_bに配置
    if (card.due_date) {
        return {
            type: 'bucket',
            dayKey: getTimelineDayKey(card.due_date, today),
            bucket: 'bucket_b',  // デフォルト
        };
    }
    
    // 4. 日付もなし → リストのみ（カンバン）
    return {
        type: 'list-only',
    };
}
```
