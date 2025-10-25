# Web Push通知音が鳴らない問題

**作成日**: 2025-10-25
**ステータス**: 調査完了・解決方法判明
**優先度**: Medium
**カテゴリ**: Notifications / Web Push

## 問題の概要

Web Push通知は表示されるが、**通知音が鳴らない**。

- ✅ PWA: 通知表示される、バッジ更新される
- ✅ Chrome: 通知表示される
- ❌ 両方とも: **音が鳴らない**

一方、同じChromeブラウザで**Google Chatは通知音が鳴る**。

## 調査経緯

### 1. 初期調査（Web Push配信問題）

最初はWeb Push自体が届いていないと思われた：

**問題**:
- Edge Functionが401エラーで失敗
- データベーストリガーからの呼び出しがJWT認証で弾かれていた

**解決**:
- Supabase Dashboard → Edge Functions → Settings → "Enforce JWT Verification" を **OFF** に変更
- `verify_jwt: false` の設定が必要

**結果**:
- ✅ Edge Functionが200で成功
- ✅ Service Workerが`[SW] Push event received`を受信
- ✅ `[SW] Notification shown successfully`が表示
- ❌ **音は鳴らず**

### 2. Service Worker設定の調整

**試したこと**:
```javascript
// sw.js
self.registration.showNotification(title, {
  silent: false,        // 音を有効化
  renotify: true,       // 同じtagでも音を鳴らす
  vibrate: [200, 100, 200]
});
```

**結果**: 音は鳴らず

### 3. Audio APIテスト

**仮説**: Notification APIが動作していないのでは？

**テスト**: "Test Sound Only" ボタンを追加して、Audio APIで直接音を再生

```javascript
const audio = new Audio('data:audio/wav;base64,...');
await audio.play();
```

**結果**:
- ✅ **音が鳴った！**（バグっぽいビープ音）
- Audio APIは動作している
- つまり、ブラウザの音再生機能自体は問題ない

### 4. Web標準の調査

**発見した事実**:

1. **カスタム通知音は不可能**
   - 2018年に`sound`プロパティが標準から削除された
   - どのブラウザも実装していない

2. **通知音はOS/ブラウザが制御**
   - `silent: false`は「音を鳴らして」というリクエストに過ぎない
   - 実際に鳴るかは**Chromeのサイト別設定**と**macOS通知設定**次第

3. **Chrome 59以降のmacOS統合**
   - Chromeはネイティブ通知システムを使用
   - macOSの「おやすみモード」を尊重

4. **Google Chatの仕組み**
   - Google Chatも`Notification API`の`silent: false`を使っているだけ
   - 音が鳴る理由: **Chromeのサイト設定で「音」が許可されているから**

## 根本原因

**Chromeのサイト別設定で、taesk.vercel.appの「音」が許可されていない**

## 解決方法

### 方法1: Chromeのサイト設定（推奨）

1. `chrome://settings/content/siteDetails?site=https://taesk.vercel.app` を開く
2. **「音」**を**「許可」**に変更

### 方法2: macOSのシステム設定

1. システム設定 → 通知 → Google Chrome
2. 「サウンド」にチェックを入れる
3. 下にスクロールして「Webサイト」セクションがあれば、`taesk.vercel.app`の「サウンド」もON

### 方法3: 通知センターから直接設定（最も簡単）

1. 通知センターを開く
2. Taeskの通知を長押しまたは右クリック
3. 「オプション」→「サウンドを再生」にチェック

## 技術的詳細

### 現在の実装

**Edge Function** (`send-push-notification/index.ts`):
```typescript
const pushPayload = JSON.stringify({
  title: 'Taesk Notification',
  body: notificationData.payload.message,
  icon: '/icon?size=192',
  badge: '/icon?size=192',
  // ...
});

await webPush.sendNotification(subscription, pushPayload, vapidDetails);
```

**Service Worker** (`public/sw.js`):
```javascript
self.addEventListener('push', (event) => {
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.badge,
      tag: data.tag,
      renotify: true,
      silent: false,      // ← OS/ブラウザが音を鳴らすべきかを決定
      vibrate: [200, 100, 200],
    })
  );
});
```

### 通知配信フロー

```
通知作成（DB INSERT）
  ↓
データベーストリガー発火
  ↓
Edge Function呼び出し (pg_net)
  ↓
Web Push送信 (webPush.sendNotification)
  ↓
Service Worker受信 (push event)
  ↓
通知表示 (showNotification)
  ↓
音再生 ← **ブラウザ/OSの設定に依存**
```

## 実装した機能（副産物）

### 1. @メンションキーボードナビゲーション

**追加機能**:
- ↑/↓キー: サジェスチョン移動
- Enter: 選択確定
- Escape: 閉じる
- 選択中の項目を青色ハイライト

**ファイル**: `app/(board)/_components/CommentsPanel.tsx`

### 2. 音声テストボタン

**追加機能**:
- "Test Sound Only" ボタン
- Audio APIで直接音を再生してデバッグ
- Consoleログで詳細な診断情報

**ファイル**: `app/(board)/_components/NotificationSettings.tsx`

### 3. Service Worker詳細ログ

**追加ログ**:
```javascript
console.log('[SW] Push event received');
console.log('[SW] Notification shown successfully:', title);
console.log('[SW] Failed to show notification:', err);
console.log('[SW] Badge updated');
```

**ファイル**: `public/sw.js`

## 関連ファイル

- `supabase/functions/send-push-notification/index.ts` - Edge Function
- `supabase/functions/send-push-notification/config.json` - JWT検証無効化
- `supabase/migrations/20251024120000_notification_push_trigger.sql` - データベーストリガー
- `public/sw.js` - Service Worker
- `lib/push-notifications.ts` - クライアント側Push通知ヘルパー
- `app/(board)/_components/NotificationSettings.tsx` - 通知設定UI
- `app/(board)/_components/CommentsPanel.tsx` - @メンション機能

## Commits

1. `3695215` - feat: enable Web Push notifications with database trigger
2. `303cd67` - feat: add keyboard navigation to @mention suggestions
3. `58598ac` - fix: correct icon path in push notifications
4. `2eb077e` - debug: add notification display logging
5. `bad38ac` - feat: add renotify to force notification sound
6. `a079e81` - feat: add audio test button for debugging notification sound

## 学んだこと

1. **Web Push通知音はカスタマイズできない**
   - ブラウザ/OSのシステム音のみ
   - `silent: false`はリクエストであり、保証ではない

2. **ブラウザのサイト別権限が重要**
   - 「通知」権限だけでなく「音」権限も必要
   - ユーザーごとに異なる設定が可能

3. **デバッグは段階的に**
   - ① Web Pushが届いているか（Edge Function logs）
   - ② Service Workerが受信しているか（SW logs）
   - ③ 通知が表示されているか（画面確認）
   - ④ 音が鳴っているか（ブラウザ/OS設定）

4. **他のサービスを参考にする**
   - Google Chatの実装を調査
   - 特別な実装はなく、標準APIのみ
   - 音が鳴る = 設定が正しいだけ

## 追加調査（2025-10-25 続き）

### 5. Chrome サイト設定「音声: 許可」に変更しても音が鳴らない

**実施したこと**:
1. Chrome サイト設定で「音声」を「自動（デフォルト）」→「**許可**」に変更
2. 「Test Sound Only」ボタンで Notification API テスト
3. コンソールで直接 `new Notification('Test', { silent: false })` 実行

**結果**:
- ✅ 通知は表示される
- ❌ **音は鳴らない**

**Google Chat との比較**:
- ✅ Google Chat (`chat.google.com`) は**同じChromeブラウザで音が鳴る**
- ✅ macOSの「集中モード」はオフ
- ✅ システム設定 → 通知 → Google Chrome → 「サウンドを再生」はオン

→ **macOS/Chrome全体の設定は正しい。Google Chatで鳴るので環境の問題ではない。**

### 6. Service Worker と NotificationSettings の統一

**発見した問題**:
- Service Worker (`public/sw.js`) に `renotify: true` と `vibrate: [200, 100, 200]` が残っていた
- これらは TypeScript の `NotificationOptions` に含まれず、音をブロックする可能性

**修正内容** (Commit: `8f049b0`):
```javascript
// Before
self.registration.showNotification(title, {
  // ...
  renotify: true,
  silent: false,
  vibrate: [200, 100, 200],
});

// After
self.registration.showNotification(title, {
  // ...
  silent: false,  // シンプルに音リクエストのみ
});
```

**結果**:
- ✅ Service Worker バージョン `1.2.0` にアップデート
- ✅ `[SW] Activate event 1.2.0` 確認
- ❌ **それでも音は鳴らない**

### 7. 直接 Notification API テスト

**テスト内容**:
```javascript
new Notification('Direct Test', {
  body: 'Testing direct notification sound',
  silent: false
});
```

**返り値の確認**:
```javascript
Notification {
  silent: false,   // ← 正しく設定されている
  renotify: false,
  requireInteraction: false,
  // ...
}
```

**結果**:
- ✅ `silent: false` が正しく設定されている
- ✅ 通知は表示される
- ❌ **音は鳴らない**

## 現在の状況まとめ

### 確認済み（問題なし）

1. ✅ **Chrome サイト設定**
   - 通知: 許可
   - 音声: **許可**（自動から変更済み）

2. ✅ **macOS システム設定**
   - システム設定 → 通知 → Google Chrome → 「サウンドを再生」: ON
   - Google Chat で音が鳴る = macOS設定は正しい

3. ✅ **集中モード**
   - オフ確認済み

4. ✅ **実装**
   - Service Worker: `silent: false` のみでシンプル化
   - NotificationSettings: `silent: false` のみでシンプル化
   - `renotify` / `vibrate` など非標準プロパティは削除済み

5. ✅ **Notification API**
   - `new Notification('Test', { silent: false })` で `silent: false` が正しく設定される
   - 通知は表示される

### 未解決

❌ **`silent: false` を設定しても音が鳴らない**

- Google Chat (同じChromeブラウザ) では音が鳴る
- Taesk (taesk.vercel.app) では音が鳴らない
- 設定・実装は標準通り
- **原因不明**

## 仮説

### 仮説1: Google Chatは独自の音再生システムを使用

Google Chatは以下の可能性：
1. **Notification API の音に頼らず、Audio API で独自に音を再生**
2. アプリが開いている時にバックグラウンドで音声ファイルを再生
3. 「お知らせ」設定の「トーン」選択は、この独自システムの設定

**検証方法**:
- Google Chat でアプリを閉じた状態（バックグラウンド）で通知を受信
- その時に音が鳴るか確認

### 仮説2: Chromeのサイト別「音声履歴」による自動判断

Chromeは以下を記録している可能性：
1. サイトでユーザーが「音を再生した」履歴
2. ユーザー操作に紐づく音再生（クリック時など）
3. この履歴があるサイトのみ `silent: false` が有効

**検証方法**:
- Taesk でユーザー操作（ボタンクリック）時に Audio API で音を再生
- これを何度か実行して「音を鳴らすサイト」として認識させる

### 仮説3: 初回のユーザー操作が必要

一部のブラウザでは：
1. **初回の通知音は、ユーザー操作後でないと鳴らない**
2. 自動的な通知（バックグラウンド）では音がブロックされる
3. 一度ユーザー操作で音を鳴らすと、以降は自動通知でも鳴る

**検証方法**:
- ボタンクリック時に `new Notification()` + Audio API の両方を実行
- その後、バックグラウンドで通知を受信して音が鳴るか確認

## Next Steps

- [ ] 仮説1の検証: Google Chat のバックグラウンド通知音を確認
- [ ] 仮説2の検証: Audio API でユーザー操作時に音を再生（履歴作成）
- [ ] 仮説3の検証: ボタンクリック時に Notification + Audio の両方実行
- [ ] Web標準の限界として受け入れ、代替案を検討（アプリ内音声のみ）

## 参考リンク

- [MDN - Notification API](https://developer.mozilla.org/en-US/docs/Web/API/Notification)
- [Chrome - Moving to native macOS notifications](https://developer.chrome.com/blog/native-mac-os-notifications)
- [Stack Overflow - Chrome Desktop push notifications sound not working](https://stackoverflow.com/questions/40190140/sound-does-not-work-in-service-worker-in-chrome-desktop-push-notification)
