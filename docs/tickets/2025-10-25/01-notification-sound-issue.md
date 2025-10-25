# Web Push通知音が鳴らない問題

**作成日**: 2025-10-25
**ステータス**: 実装完了（Web Audio ベースで通知音復旧）
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

## 最終対応（2025-10-26）

- ❌ 既存の **データURL (WAV)** を廃止し、ブラウザ組み込みの Web Audio API に統一
- ✅ `lib/notification-audio.ts` で AudioContext を集中管理し、**800Hz サイン波 + 200ms フェードアウト**のビープを生成
- ✅ `NotificationSettings` に「🔊 音声を有効化」「🎵 テスト音を再生」ボタンを追加し、ユーザーが Chrome の Autoplay 制限を解除して即時確認できるようにした
- ✅ `NotificationSoundPlayer`（隠しクライアントコンポーネント）が Service Worker からの `NOTIFICATION_RECEIVED` メッセージを受信し、タブが `visible` で audio unlocked のときだけ Web Audio サウンドを再生
- ✅ Service Worker `public/sw.js` は従来通り `silent: false` を指定しつつ、前景タブに `postMessage` を送って Web Audio 側を起動

### 動作確認手順
1. NotificationSettings モーダルで **「音声を有効化」** をクリック（`unlockAudio()` → AudioContext resume）
2. **「🎵 テスト音を再生」** をクリックし、800Hz ビープ（0.2s）が鳴ること・ログに `[Audio] Notification sound played` が出ることを確認
3. 「テスト通知を送信」を実行し、前景タブで Web Audio ビープ、背景タブでは OS 標準通知音のみになることをコンソールで確認

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

### 2. 音声テストボタン（Web Audio版）

**追加機能**:
- 「音声を有効化」ボタンで `AudioContext` を解除し、Chromeのautoplay制限に対応
- 「🎵 テスト音を再生」ボタンで **800Hz / 200ms フェードアウト**のビープを Web Audio オシレーターで生成
- Consoleログに `[Audio] Notification sound played` 等を出力し、失敗時の例外も捕捉

**ファイル**: `app/(board)/_components/NotificationSettings.tsx`

### 3. NotificationSoundPlayer & AudioManager

**追加機能**:
- `lib/notification-audio.ts` が AudioContext と unlock 状態を単一モジュールで管理
- `app/components/NotificationSoundPlayer.tsx` が Service Worker からの `NOTIFICATION_RECEIVED` メッセージをリッスンし、タブが `visible` & audio unlocked のときだけ `playNotificationSound()` を呼び出し
- 背景タブでは OS の通知音のみ鳴らし、二重再生を防止

### 4. Service Worker詳細ログ

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
- `lib/notification-audio.ts` - Web Audio ベースの通知音ヘルパー
- `app/components/NotificationSoundPlayer.tsx` - Foregroundサウンド再生
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

GPT5tの回答
了解。最新情報を踏まえて、添付の `01-notification-sound-issue.md` にそのまま貼れる“決定版”の回答文を用意しました👇
（※本文中の参考リンクはすべて 2025年10月時点の内容を確認済みです）

---

# Chromeで「着信時に通知音」を**確実に**鳴らす2025年版ガイド

**結論（TL;DR）**

* ブラウザの**Notifications API だけでは音は鳴りません**。通知に**カスタム音**を指定する手段も、現状の仕様と実装にはありません。([devdoc.net][1])
* **音を鳴らすのはページ側（メインスレッド）**で、**ユーザー操作後に解放された Web Audio** を使って再生します。着信時にタブが前面なら音再生、**背面や最小化なら OS 通知**を出す「ハイブリッド」が正解です。([Chrome for Developers][2])
* **Service Worker から直接音は鳴らせません**（ワーカーは DOM もオーディオ出力も持たないため）。通知は出せますが音の有無は OS/ブラウザに委ねられます。([devdoc.net][3])
* Slack/Google Chat も実質この考え方です：**タブが開いていればアプリ内サウンド**、そうでなければ**OSのデスクトップ通知**（音の制御はOS任せ）。Slack は通知音をアプリ設定で切替可能（＝ページ内で音を鳴らしている）。([Slack][4])

---

## なぜ Notifications API だけでは鳴らないのか

* **`NotificationOptions` に「sound」はありません**（MDN上では項目が言及されるものの「ブラウザー未対応」扱い）。よって通知に音源URLを渡して鳴らすことは不可です。([devdoc.net][1])
* 代わりに `silent`（サイレント）や `renotify`（置換時に再通知）といった**表示挙動のヒント**はありますが、**音の有無を強制する仕様ではない**です。([MDN Web Docs][5])
* **Chromeの自動再生ポリシー**により、**ユーザー操作前の音声再生はブロック**されます。Web Audio の `AudioContext` は操作前に作ると **suspended** で開始し、**クリック等の操作後に `resume()`** が必要です。([Chrome for Developers][2])
* **Service Worker はワーカー環境**で動作し、**DOM/オーディオ出力にアクセスできません**。SW からは `showNotification()` で通知を出すのみ。音はコントロール不可です。([devdoc.net][3])

> 参考：Chrome（macOS）は通知を**ネイティブの通知センター**で表示するため、音量/サウンドの扱いは OS 側の設定に従います。([Chrome for Developers][6])

---

## 正しい実装パターン（Google Chat/Slack方式）

### 1) 初回ユーザー操作で「鳴らせる権利」を確保

```js
// audio.js (ページ側)
let audioCtx;
let ringBuffer;
let audioUnlocked = false;

async function unlockAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  if (!ringBuffer) {
    const res = await fetch('/sounds/ring.mp3', { cache: 'force-cache' });
    ringBuffer = await audioCtx.decodeAudioData(await res.arrayBuffer());
  }
  audioUnlocked = true;
  console.log('Audio unlocked');
}

// クリック/タップ/キーボードなど最初の操作で解放
['click','keydown','touchstart'].forEach(ev =>
  window.addEventListener(ev, async () => { if (!audioUnlocked) await unlockAudio(); }, { once:true })
);
```

> ポイント：**ユーザー操作後に `AudioContext.resume()`** と **音源デコードの先読み**。これで**前面タブ**時の着信音再生が安定します。([Chrome for Developers][2])

### 2) 着信時の分岐（前面＝鳴らす／背面＝通知）

```js
function playRing(loop=true) {
  if (!audioUnlocked || !ringBuffer || !audioCtx) return false;
  const src = audioCtx.createBufferSource();
  src.buffer = ringBuffer;
  src.loop = loop;
  src.connect(audioCtx.destination);
  src.start(0);
  // 取り回し用に参照を返す
  return src;
}

// 例：WebSocketやSSEでサーバから「ring」イベント
async function onIncomingCall(payload) {
  const isVisible = document.visibilityState === 'visible';
  if (isVisible && audioUnlocked) {
    // タブが見えていればアプリ内で音を鳴らす
    const ringNode = playRing(true);
    // 応答/拒否で stop() するなどUI側で制御
  } else {
    // 背面なら OS 通知（音は OS 依存／カスタム不可）
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('着信中', {
      body: payload.from ?? '不明な発信者',
      tag: `call:${payload.callId}`,     // 後続更新で置換
      renotify: true,                    // 置換時に再通知
      requireInteraction: true,          // クリックまで残す
      icon: '/icons/call.png'
    });
  }
}
```

> 注意：**通知自体に音は付けられません**。音は**ページで鳴らす**、通知は**気づかせる**。役割分担がコツです。([devdoc.net][1])

### 3) Service Worker は「鳴らさず知らせる」

```js
// sw.js
self.addEventListener('push', event => {
  const data = event.data?.json() ?? {};
  event.waitUntil((async () => {
    // OS通知（音制御不可）
    await self.registration.showNotification('着信中', {
      body: data.from ?? '不明な発信者',
      tag: `call:${data.callId}`,
      renotify: true,
      requireInteraction: true,
      icon: '/icons/call.png'
    });
    // 開いているクライアントに「鳴らして」と伝える
    const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsList) c.postMessage({ type: 'INCOMING_CALL', payload: data });
  })());
});

// ページ側で SW からのメッセージを受け取って前面なら音を鳴らす
navigator.serviceWorker.addEventListener('message', (ev) => {
  if (ev.data?.type === 'INCOMING_CALL') onIncomingCall(ev.data.payload);
});
```

> **SW にはオーディオ出力がない**ため、**ページへ postMessage** して再生させます。([devdoc.net][3])

---

## ブラウザ/OS 設定でハマりがちなポイント（必読）

1. **Chrome の自動再生ポリシー**
   ユーザー操作前の音再生はブロックされます。**初回に「サウンドを有効化する」ボタン**を用意して `AudioContext.resume()` してください。([Chrome for Developers][2])

2. **サイトの「音声」許可**（Chrome）
   企業環境やユーザー設定で **「サイトの音声をブロック」** が有効だと鳴りません。**`chrome://settings/content/sound`** またはアドレスバー左の**カギアイコン → サイトの設定 →「音声：許可」**を案内しましょう。([help.fandraft.com][7])

3. **OS 側の通知／集中モード**
   macOS の Chrome は**ネイティブ通知**を使うため、**通知音の有無・鳴り方はOS次第**です（おやすみモード等の影響を受けます）。([Chrome for Developers][6])

4. **Chrome の仕様アップデートに注意**
   2025年は、**放置サイトの通知権限を自動的に剥奪**する新機能が順次導入中。通知が出なくなった場合に**再許可**の導線を用意しておくと安全です。([The Verge][8])

---

## Google Chat / Slack はどうしている？

* **Slack**：デスクトップ版/ブラウザ版ともに**通知音を選択**できます。これは**ページ内での音再生**を行っていることの裏付けです。背面時は OS 通知（音は OS 任せ）。([Slack][4])
* **Google Chat（ブラウザ）**：常時通知を受けるために**タブを生かす／PWA化**しておく運用が一般的（＝ページが生きていれば自前サウンド可、背面はOS通知）。※実例として、Chatのバックグラウンドタブを維持して通知を逃しにくくする拡張が存在します。([Chromeウェブストア][9])

> いずれも **「前面＝アプリ内サウンド」「背面＝OS通知」** のハイブリッド。**通知に音を直付けする方式ではありません**。

---

## 実装チェックリスト（そのまま使えます）

* [ ] 初回クリック等で `AudioContext` を `resume()`、着信音を `decodeAudioData()` 済みにする。([Chrome for Developers][2])
* [ ] **前面タブ**：Web Audioでループ再生、応答/拒否で stop。
* [ ] **背面タブ**：`ServiceWorkerRegistration.showNotification()`（`requireInteraction`, `tag`, `renotify` を適宜）。([MDN Web Docs][10])
* [ ] **SW**→ページへ `postMessage`（SWは音を鳴らさない）。([devdoc.net][3])
* [ ] **Chrome 設定**：対象ドメインの**音声=許可**をガイド。([help.fandraft.com][7])
* [ ] **OS通知**：macOS の通知設定・集中モードの注意書きをヘルプに記載。([Chrome for Developers][6])
* [ ] **権限自動剥奪**への備え（通知が出なければ**再許可**を促すUI）。([The Verge][8])

---

## よくある誤解・アンチパターン

* **「通知APIで音を指定できるのでは？」** → できません（`sound` は未実装）。([devdoc.net][1])
* **「SWからAudioを鳴らせるのでは？」** → できません（ワーカーにはDOMもオーディオ出力もない）。([devdoc.net][3])
* **「自動で勝手に鳴ってほしい」** → Chromeの自動再生ポリシーがあるため**必ずユーザー操作後**に解放する設計が必要です。([Chrome for Developers][2])

---

## 付録：ミニ実装（必要最小限）

```html
<button id="enable-sound">通知音を有効化</button>
<script type="module">
import { unlockAudio, onIncomingCall } from '/audio.js';

navigator.serviceWorker.register('/sw.js');

document.getElementById('enable-sound').addEventListener('click', unlockAudio);

// ダミー：着信イベント受信
window.mockRing = (from='caller') => onIncomingCall({ from, callId: crypto.randomUUID() });
</script>
```

---

### 参考

* Chrome の自動再生ポリシー（ユーザー操作後に `AudioContext.resume()` が必要）([Chrome for Developers][2])
* Notifications API の現状（`sound` は未実装、`silent`/`renotify` 等の動作ヒントのみ）([devdoc.net][1])
* Service Worker は DOM/オーディオ出力なし（通知は出せるが音は不可）([devdoc.net][3])
* macOS の Chrome はネイティブ通知を使用（音は OS に準拠）([Chrome for Developers][6])
* Slack の通知音設定（＝アプリ内サウンド採用の証左）([Slack][4])
* Chrome が**放置サイトの通知権限を自動剥奪**する新機能（2025年10月報道）([The Verge][8])

---

> 本ドキュメントは Aterrace Inc. 内の検討メモ（着信通知音の課題）に対する回答です。

---

**最近の関連ニュース（通知まわりの挙動変化）**

* [The Verge](https://www.theverge.com/news/798122/google-chrome-website-notifications-disable-feature?utm_source=chatgpt.com)
* [TechRadar](https://www.techradar.com/computing/chrome/google-chrome-is-fixing-its-notification-overload-problem-with-this-handy-new-feature-heres-how-it-works?utm_source=chatgpt.com)

---

[1]: https://www.devdoc.net/web/developer.mozilla.org/en-US/docs/Web/API/notification/Notification.html?utm_source=chatgpt.com "Notification.Notification() - Web APIs | MDN"
[2]: https://developer.chrome.com/blog/autoplay/?utm_source=chatgpt.com "Autoplay policy in Chrome  |  Blog  |  Chrome for Developers"
[3]: https://devdoc.net/web/developer.mozilla.org/en-US/docs/Web/API/ServiceWorker_API.html?utm_source=chatgpt.com "Service Worker API - Web APIs | MDN"
[4]: https://slack.com/help/articles/201355156-Configure-your-Slack-notifications?utm_source=chatgpt.com "Configure your Slack notifications | Slack"
[5]: https://developer.mozilla.org/en-US/docs/Web/API/Notification/silent?utm_source=chatgpt.com "Notification: silent property - Web APIs | MDN"
[6]: https://developer.chrome.com/blog/native-mac-os-notifications?utm_source=chatgpt.com "Moving to the native notification system on macOS  |  Blog  |  Chrome for Developers"
[7]: https://help.fandraft.com/article/142-no-sound-is-playing?utm_source=chatgpt.com "No Sound is Playing - FanDraft Help Center"
[8]: https://www.theverge.com/news/798122/google-chrome-website-notifications-disable-feature?utm_source=chatgpt.com "Chrome will automatically disable web notifications you don't care about"
[9]: https://chromewebstore.google.com/detail/google-chat-background-no/hfknjkannpafnoidganhlmplfomlifnc?utm_source=chatgpt.com "Google Chat Background Notifier - Chrome Web Store"
[10]: https://developer.mozilla.org/en-US/docs/Web/API/Notification/renotify?utm_source=chatgpt.com "Notification: renotify property - Web APIs | MDN"
