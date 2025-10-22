# 0303 通知設定のバックエンド実装

**作成日**: 2025-10-22
**親チケット**: 0208 通知許可・設定UX (未完了分)
**優先度**: **Priority 2**
**担当候補**: BE (API Routes) + FE (設定ページ)

---

## 🎯 ゴール
- 0208 で「100% 完了」と主張されていたが、実際には UI のみだった通知設定機能のバックエンドを実装する
- ユーザーが設定した通知設定 (In-App/Push オン/オフ、Quiet hours) が実際に DB に保存され、機能するようにする
- 設定に基づいて通知生成・Push送信を制御できるようにする

---

## 📝 背景
0301-status.md の検証結果、0208 は以下の状態であることが判明:
- ✅ `NotificationSettings.tsx` コンポーネント作成済み (UI のみ)
- ❌ `notification_preferences` テーブル未作成
- ❌ `/api/notifications/preferences` API Route 未実装
- ❌ Quiet hours ロジック未実装
- ❌ `web_push_enabled` チェック未実装
- ❌ 設定ページ未作成

**実装完了率**: 40% → 100% へ引き上げ

---

## ✅ スコープ

### 1. **`notification_preferences` テーブル作成**
```sql
CREATE TABLE notification_preferences (
  profile_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  in_app_enabled BOOLEAN DEFAULT true,
  web_push_enabled BOOLEAN DEFAULT false,
  quiet_hours JSONB DEFAULT NULL,  -- { "start": "22:00", "end": "07:00", "timezone": "Asia/Tokyo" }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: ユーザーは自分の設定のみ操作可能
ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own preferences" ON notification_preferences
  FOR SELECT USING (auth.uid() = profile_id);

CREATE POLICY "Users can update own preferences" ON notification_preferences
  FOR UPDATE USING (auth.uid() = profile_id);

CREATE POLICY "Users can insert own preferences" ON notification_preferences
  FOR INSERT WITH CHECK (auth.uid() = profile_id);
```

### 2. **API Routes 実装**
- `GET /api/notifications/preferences` - 現在の設定を取得
- `PUT /api/notifications/preferences` - 設定を更新 (upsert)

### 3. **Quiet hours ロジックの実装**
- 通知生成サービス (`lib/server/notifications.ts`) で Quiet hours をチェック
- Edge Function (`send-push-notification`) で Quiet hours をチェック
- Quiet hours 中の場合は `snoozed_at` フラグを立てるか、通知作成をスキップ

### 4. **`web_push_enabled` チェック**
- Edge Function で送信前に `notification_preferences` を確認
- `web_push_enabled = false` の場合はスキップ

### 5. **設定ページの作成**
- `/settings/notifications` ページ
- トグルスイッチ (In-App / Web Push)
- Quiet hours 入力 (Time picker)
- 通知テストボタン

### 6. **通知テスト機能**
- 自分宛てにテスト通知を送信するAPI
- `POST /api/notifications/test`

---

## 🚫 非スコープ
- 組織/ボード単位の通知設定 (将来検討)
- メール通知
- タイムゾーン自動検出 (ユーザーが手動選択)

---

## 📦 実装タスク

### **タスク 1: データベーススキーマの作成**
- [ ] マイグレーションファイル作成: `20251022000004_notification_preferences.sql`
- [ ] `notification_preferences` テーブル作成
- [ ] RLS ポリシー設定
- [ ] デフォルト値の設定

**ファイル**: `supabase/migrations/20251022000004_notification_preferences.sql`

### **タスク 2: TypeScript 型定義の追加**
- [ ] `lib/supabase.ts` に `NotificationPreferences` 型を追加

```typescript
export interface NotificationPreferences {
  profile_id: string;
  in_app_enabled: boolean;
  web_push_enabled: boolean;
  quiet_hours: {
    start: string;  // "HH:mm" format
    end: string;    // "HH:mm" format
    timezone: string;  // IANA timezone (e.g., "Asia/Tokyo")
  } | null;
  created_at: string;
  updated_at: string;
}
```

### **タスク 3: GET /api/notifications/preferences 実装**
- [ ] ファイル作成: `app/api/notifications/preferences/route.ts`
- [ ] GET ハンドラー実装
- [ ] デフォルト値を返す (レコードが存在しない場合)

```typescript
export async function GET(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get preferences or return defaults
  let { data: prefs, error } = await supabase
    .from('notification_preferences')
    .select('*')
    .eq('profile_id', user.id)
    .single();

  if (error && error.code === 'PGRST116') {
    // No record found, return defaults
    prefs = {
      profile_id: user.id,
      in_app_enabled: true,
      web_push_enabled: false,
      quiet_hours: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  } else if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(prefs);
}
```

### **タスク 4: PUT /api/notifications/preferences 実装**
- [ ] PUT ハンドラー実装
- [ ] バリデーション (Zod)
- [ ] Upsert ロジック

```typescript
const preferencesSchema = z.object({
  in_app_enabled: z.boolean(),
  web_push_enabled: z.boolean(),
  quiet_hours: z.object({
    start: z.string().regex(/^\d{2}:\d{2}$/),
    end: z.string().regex(/^\d{2}:\d{2}$/),
    timezone: z.string(),
  }).nullable(),
});

export async function PUT(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const validated = preferencesSchema.parse(body);

  const { data, error } = await supabase
    .from('notification_preferences')
    .upsert({
      profile_id: user.id,
      ...validated,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
```

### **タスク 5: Quiet hours ロジックの実装**

#### 5-1. ユーティリティ関数の作成
- [ ] ファイル作成: `lib/server/quiet-hours.ts`

```typescript
export function isWithinQuietHours(
  quietHours: { start: string; end: string; timezone: string } | null,
  timestamp: Date = new Date()
): boolean {
  if (!quietHours) return false;

  try {
    // Convert timestamp to user's timezone
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: quietHours.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const userTime = formatter.format(timestamp);
    const [hours, minutes] = userTime.split(':').map(Number);
    const currentMinutes = hours * 60 + minutes;

    // Parse start/end times
    const [startHours, startMinutes] = quietHours.start.split(':').map(Number);
    const [endHours, endMinutes] = quietHours.end.split(':').map(Number);
    const startMinutesTotal = startHours * 60 + startMinutes;
    const endMinutesTotal = endHours * 60 + endMinutes;

    // Handle overnight quiet hours (e.g., 22:00 - 07:00)
    if (startMinutesTotal > endMinutesTotal) {
      return currentMinutes >= startMinutesTotal || currentMinutes < endMinutesTotal;
    }

    return currentMinutes >= startMinutesTotal && currentMinutes < endMinutesTotal;
  } catch (error) {
    console.error('Error checking quiet hours:', error);
    return false;
  }
}
```

#### 5-2. 通知生成サービスでの適用
- [ ] `lib/server/notifications.ts` の `createNotification` を修正
- [ ] Quiet hours 中の場合は通知を作成しない (または `snoozed_at` フラグを立てる)

```typescript
export async function createNotification(params: CreateNotificationParams) {
  const { supabase, type, recipientId, payload, dedupeKey } = params;

  // Check quiet hours
  const { data: prefs } = await supabase
    .from('notification_preferences')
    .select('quiet_hours')
    .eq('profile_id', recipientId)
    .single();

  if (prefs?.quiet_hours && isWithinQuietHours(prefs.quiet_hours)) {
    console.log(`User ${recipientId} is in quiet hours, skipping notification`);
    return { data: null, isDuplicate: false, skipped: true };
  }

  // ... existing logic
}
```

#### 5-3. Edge Functionでの適用
- [ ] `supabase/functions/send-push-notification/index.ts` を修正
- [ ] `web_push_enabled` と Quiet hours をチェック

```typescript
// Get recipient preferences
const { data: prefs } = await supabase
  .from('notification_preferences')
  .select('web_push_enabled, quiet_hours')
  .eq('profile_id', notificationData.recipient_id)
  .single();

if (!prefs || !prefs.web_push_enabled) {
  console.log('Web Push disabled for user:', notificationData.recipient_id);
  return new Response(
    JSON.stringify({ success: true, message: 'Web Push disabled' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

if (prefs.quiet_hours && isWithinQuietHours(prefs.quiet_hours)) {
  console.log('User in quiet hours:', notificationData.recipient_id);
  return new Response(
    JSON.stringify({ success: true, message: 'Quiet hours active' }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}
```

### **タスク 6: NotificationSettings コンポーネントの更新**
- [ ] `app/(board)/_components/NotificationSettings.tsx` を修正
- [ ] API との連携 (GET/PUT)
- [ ] Quiet hours 入力フォームの追加
- [ ] タイムゾーンセレクターの追加

```typescript
const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetchPreferences();
}, []);

const fetchPreferences = async () => {
  const response = await fetch('/api/notifications/preferences');
  const data = await response.json();
  setPreferences(data);
  setLoading(false);
};

const handleSave = async () => {
  const response = await fetch('/api/notifications/preferences', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(preferences),
  });

  if (response.ok) {
    toast.success('Settings saved');
  } else {
    toast.error('Failed to save settings');
  }
};
```

### **タスク 7: 設定ページの作成**
- [ ] ファイル作成: `app/settings/notifications/page.tsx`
- [ ] レイアウト調整
- [ ] モバイル対応

または、既存の `NotificationSettings` モーダルを拡張する場合:
- [ ] モーダルに Quiet hours セクションを追加
- [ ] タイムゾーンセレクター追加

### **タスク 8: 通知テスト機能の実装**
- [ ] ファイル作成: `app/api/notifications/test/route.ts`
- [ ] テスト通知を自分宛てに送信

```typescript
export async function POST(request: Request) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Create test notification
  const { error } = await supabase
    .from('notifications')
    .insert({
      recipient_id: user.id,
      type: 'test',
      payload: {
        message: 'This is a test notification from Taesk',
      },
    });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] UI にテストボタンを追加 (`NotificationSettings.tsx`)

```tsx
<button
  onClick={async () => {
    const response = await fetch('/api/notifications/test', { method: 'POST' });
    if (response.ok) {
      toast.success('Test notification sent!');
    }
  }}
  className="btn-secondary"
>
  Send Test Notification
</button>
```

---

## ✅ 受け入れ基準
- [ ] 設定ページ（またはモーダル）で In-App/Push のオン/オフを切り替えられる
- [ ] 設定変更後、DB に反映される (`notification_preferences` テーブル)
- [ ] Quiet hours を設定すると、その時間帯に通知が生成されない (または Push が送信されない)
- [ ] `web_push_enabled = false` の場合、Push 通知が送信されない
- [ ] 「テスト通知を送信」ボタンをクリックすると、自分宛てに通知が届く
- [ ] 設定変更後に即座に UI が更新される (Optimistic Update)

---

## 🧪 テスト

### **手動テスト**
1. **基本機能**
   - [ ] 設定ページで In-App を OFF にする → コメント投稿 → 通知ベルに表示されない
   - [ ] Push を OFF にする → コメント投稿 → プッシュ通知が届かない

2. **Quiet hours**
   - [ ] Quiet hours を 22:00-07:00 に設定
   - [ ] 23:00 にコメント投稿 → 通知が生成されない (または Push が送信されない)
   - [ ] 10:00 にコメント投稿 → 通知が正常に届く

3. **通知テスト**
   - [ ] 「テスト通知を送信」ボタンをクリック → 通知ベルに表示される
   - [ ] Push が有効な場合、プッシュ通知も届く

### **API テスト**
```bash
# GET
curl -X GET http://localhost:3000/api/notifications/preferences \
  -H "Cookie: ..."

# PUT
curl -X PUT http://localhost:3000/api/notifications/preferences \
  -H "Content-Type: application/json" \
  -H "Cookie: ..." \
  -d '{"in_app_enabled":true,"web_push_enabled":false,"quiet_hours":{"start":"22:00","end":"07:00","timezone":"Asia/Tokyo"}}'
```

---

## 📎 依存関係
- 前提: 0205 (In-App通知UI) 完了済み
- 前提: 0206 (Push購読) 完了済み
- 関連: 0302 (Web Push送信) - Quiet hours チェックを連携
- 後続: 0304 (E2E/ドキュメント)

---

## ❓ オープン課題
- タイムゾーン自動検出 vs 手動選択 (現状は手動選択)
- `snoozed` 通知の再送タイミング (現状は再送なし、単にスキップ)
- ボード単位の通知設定 (将来検討)

---

## 📊 工数見積
- **見積**: 2-3時間
  - DB スキーマ + API Routes: 1時間
  - Quiet hours ロジック: 0.5-1時間
  - UI 更新 + 設定ページ: 0.5-1時間
  - テスト機能: 0.5時間

---

## 📝 メモ
- 0208 チケットで「100% 完了」と主張されていたが、実際には UI のみで DB/API が未実装だった
- 本チケットで真の意味での「完了」を達成する
