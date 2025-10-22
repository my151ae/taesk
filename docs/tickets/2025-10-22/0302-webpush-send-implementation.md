# 0302 Web Push 実送信ロジック実装

**作成日**: 2025-10-22
**親チケット**: 0207 Web Push 送信 Edge Function (未完了分)
**優先度**: **最優先 (Priority 1)**
**担当候補**: BE (Deno/Edge Functions)

---

## 🎯 ゴール
- 0207 で「100% 完了」と主張されていたが、実際には未実装だった Web Push 送信ロジックを完全に実装する
- プッシュ通知が実際にブラウザに届き、ユーザーが受信できる状態にする
- 送信履歴・エラーハンドリング・冪等性を備えた本番運用可能な実装にする

---

## 📝 背景
0301-status.md の検証結果、0207 は以下の状態であることが判明:
- ✅ Edge Function スケルトン作成済み
- ✅ Database Trigger 作成済み
- ❌ **`sendWebPush` 関数が未実装** (TODO コメントのまま)
- ❌ 送信履歴テーブル未作成
- ❌ Edge Function 未デプロイ
- ❌ Supabase Secrets 未設定

**実装完了率**: 30% → 100% へ引き上げ

---

## ✅ スコープ

### 1. **`sendWebPush` 関数の実装**
- VAPID署名の生成
- Payloadの暗号化 (AES-GCM)
- HTTP/2 リクエストの送信 (push service endpoint へ)
- 410 Gone / 404 Not Found エラー時の購読削除
- リトライロジック (5xx エラー)

### 2. **`notification_delivery_logs` テーブル作成**
```sql
CREATE TABLE notification_delivery_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES push_subscriptions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'retrying')),
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_delivery_logs_notification ON notification_delivery_logs(notification_id);
CREATE INDEX idx_delivery_logs_subscription ON notification_delivery_logs(subscription_id);
CREATE INDEX idx_delivery_logs_created_at ON notification_delivery_logs(created_at);
```

### 3. **`push_subscriptions` の拡張**
```sql
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;

CREATE INDEX idx_push_subscriptions_failure_count ON push_subscriptions(failure_count)
  WHERE failure_count > 0;
```

### 4. **冪等性処理**
- `notification_delivery_logs` を確認し、同じ通知を重複送信しない
- `dedupe_key` での判定ロジック

### 5. **レート制御**
- 1ユーザーあたり/1分に最大10通知まで
- 環境変数 `PUSH_RATE_LIMIT_PER_MINUTE` で設定可能

### 6. **Edge Function デプロイ**
```bash
supabase functions deploy send-push-notification
```

### 7. **Supabase Secrets 設定**
```bash
supabase secrets set VAPID_PUBLIC_KEY="..."
supabase secrets set VAPID_PRIVATE_KEY="..."
supabase secrets set VAPID_SUBJECT="mailto:admin@taesk.app"
```

---

## 🚫 非スコープ
- 通知設定 UI (0303 で実装)
- E2E テスト (0304 で実装)
- メール通知など他チャネル

---

## 📦 実装タスク

### **タスク 1: Deno用Web Pushライブラリの選定と実装**
- [ ] `https://deno.land/x/webpush` または互換ライブラリを選定
- [ ] `sendWebPush` 関数を実装 (`supabase/functions/send-push-notification/index.ts:54-75`)
- [ ] VAPID署名の生成
- [ ] Payloadの暗号化 (AES-GCM, RFC 8291)
- [ ] HTTP/2 リクエストの送信

**参考実装**:
```typescript
async function sendWebPush(
  subscription: {
    endpoint: string;
    p256dh: string;
    auth: string;
  },
  payload: string,
  vapidDetails: {
    publicKey: string;
    privateKey: string;
    subject: string;
  }
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  // 1. VAPID署名を生成
  const vapidHeaders = await generateVAPIDHeaders(
    subscription.endpoint,
    vapidDetails.publicKey,
    vapidDetails.privateKey,
    vapidDetails.subject
  );

  // 2. Payloadを暗号化
  const encryptedPayload = await encryptPayload(
    payload,
    subscription.p256dh,
    subscription.auth
  );

  // 3. Push service endpointにHTTP/2 POSTリクエスト
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...vapidHeaders,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body: encryptedPayload,
  });

  if (response.ok || response.status === 201) {
    return { success: true, statusCode: response.status };
  }

  // 4. エラーハンドリング
  if (response.status === 410 || response.status === 404) {
    // 購読が無効
    return { success: false, statusCode: response.status, error: 'Subscription expired' };
  }

  if (response.status >= 500) {
    // サーバーエラー (リトライ可能)
    return { success: false, statusCode: response.status, error: 'Server error' };
  }

  return { success: false, statusCode: response.status, error: await response.text() };
}
```

### **タスク 2: データベーススキーマの更新**
- [ ] マイグレーションファイル作成: `20251022000003_webpush_delivery_tracking.sql`
- [ ] `notification_delivery_logs` テーブル作成
- [ ] `push_subscriptions` に `last_sent_at`, `failure_count` 追加
- [ ] インデックス作成

### **タスク 3: 冪等性処理の実装**
- [ ] Edge Function で `notification_delivery_logs` を確認
- [ ] 既に送信済みの場合はスキップ
- [ ] 送信後にログを記録

**実装箇所**: `supabase/functions/send-push-notification/index.ts:110` 付近
```typescript
// Check if already sent
const { data: existingLog } = await supabase
  .from('notification_delivery_logs')
  .select('id')
  .eq('notification_id', notificationData.notification_id)
  .eq('subscription_id', sub.id)
  .single();

if (existingLog) {
  console.log('Already sent to this subscription, skipping');
  continue;
}
```

### **タスク 4: エラーハンドリングと購読削除**
- [ ] 410 Gone / 404 Not Found 時に `push_subscriptions` から削除
- [ ] `failure_count` を increment
- [ ] `failure_count >= 5` の場合は購読を無効化

**実装箇所**: `supabase/functions/send-push-notification/index.ts:170-187` を修正
```typescript
if (!result.success) {
  if (result.statusCode === 410 || result.statusCode === 404) {
    // 購読が無効 - 削除
    await supabase
      .from('push_subscriptions')
      .delete()
      .eq('id', failedSub.id);
  } else {
    // その他のエラー - failure_countを増やす
    const newCount = (failedSub.failure_count || 0) + 1;
    if (newCount >= 5) {
      // 連続5回失敗 - 購読を無効化
      await supabase
        .from('push_subscriptions')
        .delete()
        .eq('id', failedSub.id);
    } else {
      await supabase
        .from('push_subscriptions')
        .update({ failure_count: newCount })
        .eq('id', failedSub.id);
    }
  }
}
```

### **タスク 5: レート制御の実装**
- [ ] 1分あたりの送信回数を `notification_delivery_logs` から取得
- [ ] 制限を超えた場合はスキップ (ログ記録)

**実装箇所**: Edge Function の冒頭
```typescript
const RATE_LIMIT = parseInt(Deno.env.get('PUSH_RATE_LIMIT_PER_MINUTE') || '10');

// Check rate limit
const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();
const { count } = await supabase
  .from('notification_delivery_logs')
  .select('*', { count: 'exact', head: true })
  .eq('subscription_id', sub.id)
  .gte('created_at', oneMinuteAgo);

if (count && count >= RATE_LIMIT) {
  console.log(`Rate limit exceeded for subscription ${sub.id}, skipping`);
  continue;
}
```

### **タスク 6: Edge Function デプロイ**
- [ ] `.env.local` の VAPID keys を Supabase Secrets に設定
```bash
supabase secrets set VAPID_PUBLIC_KEY="$(grep NEXT_PUBLIC_VAPID_PUBLIC_KEY .env.local | cut -d'=' -f2)"
supabase secrets set VAPID_PRIVATE_KEY="$(grep VAPID_PRIVATE_KEY .env.local | cut -d'=' -f2)"
supabase secrets set VAPID_SUBJECT="mailto:admin@taesk.app"
```

- [ ] Edge Function をデプロイ
```bash
supabase functions deploy send-push-notification --project-ref your-project-ref
```

- [ ] デプロイ後の動作確認 (ログ確認)
```bash
supabase functions logs send-push-notification --project-ref your-project-ref
```

### **タスク 7: ローカル開発環境での動作確認**
- [ ] `supabase functions serve send-push-notification` でローカル起動
- [ ] ngrok等でエンドポイントを公開 (HTTPS必須)
- [ ] Database Triggerの `app.supabase_url` を設定
```sql
ALTER DATABASE postgres SET app.supabase_url = 'https://your-project-ref.supabase.co';
```

- [ ] コメント投稿 → 通知生成 → Push送信までの一連のフローを手動テスト

---

## ✅ 受け入れ基準
- [ ] コメント作成時に自動的にプッシュ通知が送信され、ブラウザで受信できる
- [ ] `notification_delivery_logs` に送信履歴が記録される
- [ ] 410 Gone エラー時に `push_subscriptions` から自動削除される
- [ ] 同じ通知を複数回送信しない (冪等性)
- [ ] レート制御が働き、1分に10通を超えた場合はスキップされる
- [ ] `failure_count >= 5` の購読は自動的に削除される

---

## 🧪 テスト

### **手動テスト**
1. **準備**
   - [ ] Push購読を有効化
   - [ ] Supabase Secrets 設定確認

2. **テスト実行**
   - [ ] カードにコメントを投稿
   - [ ] 3秒以内にプッシュ通知を受信

3. **データ確認**
   - [ ] `notifications` テーブルにレコードが作成されている
   - [ ] `notification_delivery_logs` にステータス `success` で記録されている
   - [ ] `push_subscriptions.last_sent_at` が更新されている

4. **エラーケースのテスト**
   - [ ] 無効な購読endpoint (手動でDBを書き換え) → 410エラー → 削除される
   - [ ] 1分間に11通送信 → 11通目がスキップされる

### **自動テスト**
- [ ] E2E テストは 0304 で実装予定

---

## 📎 依存関係
- 前提: 0206 (Push購読) 完了済み
- 前提: Database Trigger 作成済み
- 後続: 0303 (設定UX)、0304 (E2E/ドキュメント)

---

## ❓ オープン課題
- Deno の Web Push ライブラリの安定性 (`https://deno.land/x/webpush` は v0.1.x)
- HTTP/2 サポート (Deno `fetch` は HTTP/2 対応しているか要確認)
- VAPID鍵ローテーション手順 (将来の課題)

---

## 📊 工数見積
- **見積**: 2-3時間
  - `sendWebPush` 実装: 1-1.5時間
  - DB スキーマ更新: 0.5時間
  - Edge Function デプロイ・動作確認: 0.5-1時間

---

## 📝 メモ
- 0207 チケットで「100% 完了」と主張されていたが、実際にはスケルトンのみだった
- 本チケットで真の意味での「完了」を達成する
