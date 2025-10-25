# App Badging + Favicon Badge 実装ガイド

> 目的：**対応ブラウザでは App Badging API（`navigator.setAppBadge`）を使い、非対応では Canvas で favicon に赤丸を重ねる**。可能ならタイトルにも未読数を併記してアクセシビリティを補完する。プログレッシブエンハンス構成で実装する。

---

## 結論（実装方針）

- **まず App Badging API を feature-detect して実行**（PWA など“アプリ”として動作する環境）。Safari の **iOS/iPadOS 16.4+ のホーム画面 Web アプリ**、**macOS Sonoma 以降の Dock に追加した Safari Web アプリ**、Windows/macOS の **Chrome / Edge のインストール済み PWA** で有効。citeturn3search4turn3search5turn2search0
- **未対応／不発時は favicon バッジに自動フォールバック**（Canvas で 16/32px を再生成し `<link rel="icon">` を差し替え）。
- （任意）**`(12) Taesk` のようにタイトルへ未読数を併記**。UA/OS の仕様で OS バッジが現れない環境でもユーザーに伝わる。

---

## 対応状況（2025-10-26 時点）

> App Badging は **“アプリとしてインストール/追加” 前提**のプラットフォームが多い点に留意。Chrome/Edge は PWA、Safari は Web アプリ（ホーム画面 / Dock）で動作。citeturn2search0turn3search4turn3search5

| OS / ブラウザ | 状態 | 備考 |
|---|---|---|
| **Windows / macOS — Chrome 81+ / Edge 81+** | **対応** | インストール済み PWA で利用可。SW からも呼べる。citeturn2search0 |
| **macOS 14+（Sonoma 以降） — Safari 17+** | **対応** | Safari の「Dock に追加」で作成した **Webアプリ**は badging をサポート。citeturn3search5turn3search2 |
| **iOS / iPadOS 16.4+ — Safari（ホーム画面 Web アプリ）** | **対応** | ホーム画面追加の **Web アプリ限定**で `setAppBadge/clearAppBadge`。通知許可が必要。citeturn3search4 |
| **Android（Chrome 系）** | **未対応** | API は未対応。**通知**を発行すると OS が自動的にバッジ表示（アプリ側で数値設定は不可）。citeturn2search0 |
| **Linux（Chrome/Edge 系）** | **API はあるが OS バッジは非表示** | Linux の一般的なデスクトップ環境ではアプリアイコンにバッジが表示されない。citeturn4search0turn4search6 |
| **Firefox（デスクトップ / Android）** | **未対応** | Badging API 非対応。citeturn5search3 |
| **Opera（デスクトップ）** | **対応（Chromium ベース）** | 最新の互換データではサポート入り。citeturn5search7 |

> 参考: MDN のハウツー記事は「**Linux はバッジが表示されない**」「**デスクトップは Windows/macOS の Chrome/Edge のみ**」と明記。Safari のサポートは iOS 16.4+ と別文書で確認。citeturn4search0

---

## API の使い方（最小）

```ts
// badge.ts
export async function trySetAppBadge(count?: number) {
  try {
    if ('setAppBadge' in navigator) {
      // count=0 は clear と同義
      // Safari iOS/macOS では Webアプリ（ホーム画面/Dock）でのみ効く
      // Chrome/Edge ではインストール済み PWA で効く
      // @ts-ignore
      await navigator.setAppBadge?.(count);
      return true;
    }
  } catch {}
  return false;
}

export async function tryClearAppBadge() {
  try {
    if ('clearAppBadge' in navigator) {
      // @ts-ignore
      await navigator.clearAppBadge?.();
      return true;
    }
  } catch {}
  return false;
}
```

- Chrome Dev の解説：インストール基準、`setAppBadge/clearAppBadge` の仕様、SW からの呼び出しが可能。citeturn2search0
- WebKit の解説：**iOS 16.4+ はホーム画面 Web アプリ限定**、通知許可の取り扱い。citeturn3search4

---

## Favicon バッジ（フォールバック）

```ts
// favicon-badge.ts
let originalLinks: { el: HTMLLinkElement; href: string }[] = [];
let baseImg: HTMLImageElement | null = null;

// 初期化：<link rel="icon"> の現在値をキャッシュし、ベース画像をロード
export function setupFaviconBadge(baseHref?: string) {
  if (originalLinks.length === 0) {
    const links = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel*="icon"]'));
    originalLinks = links.map((el) => ({ el, href: el.href }));
  }
  const src = baseHref || originalLinks[0]?.href || '/icon?size=64';
  baseImg = new Image();
  baseImg.decoding = 'async';
  baseImg.src = src;
}

function ensureIconLinks() {
  const head = document.head;
  const getOrCreate = (size: 16 | 32) => {
    let el = head.querySelector<HTMLLinkElement>(`link[rel*="icon"][sizes="${size}x${size}"]`);
    if (!el) {
      el = document.createElement('link');
      el.rel = 'icon';
      el.sizes = `${size}x${size}`;
      head.appendChild(el);
    }
    return el;
  };
  return { l16: getOrCreate(16), l32: getOrCreate(32) };
}

function draw(count: number, target: 16 | 32) {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  const size = target * dpr;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;

  if (baseImg && baseImg.complete) ctx.drawImage(baseImg, 0, 0, size, size);

  if (count > 0) {
    // 赤丸（右上）
    const r = Math.round(size * 0.28);
    const cx = Math.round(size * 0.72);
    const cy = Math.round(size * 0.28);
    ctx.fillStyle = '#F44336';
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

    if (target >= 32) {
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${Math.round(size * 0.38)}px system-ui, -apple-system, Segoe UI, Arial`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const text = count > 99 ? '99+' : String(count);
      ctx.fillText(text, cx, cy + Math.round(size * 0.02));
    }
  }

  const out = document.createElement('canvas');
  out.width = out.height = target;
  out.getContext('2d')!.drawImage(c, 0, 0, target, target);
  return out.toDataURL('image/png');
}

export function setFaviconBadge(count: number) {
  if (!baseImg) setupFaviconBadge();
  const { l16, l32 } = ensureIconLinks();
  l16.href = draw(count, 16);
  l32.href = draw(count, 32);
}

export function clearFaviconBadge() {
  for (const { el, href } of originalLinks) {
    try { el.href = href; } catch {}
  }
}
```

---

## 統合ユーティリティ（統一 API）

```ts
// unified-badge.ts
import { trySetAppBadge, tryClearAppBadge } from './badge';
import { setFaviconBadge, clearFaviconBadge } from './favicon-badge';

export async function setUnifiedBadge(count: number) {
  const ok = await trySetAppBadge(count);
  if (!ok) {
    if (count > 0) setFaviconBadge(count);
    else clearFaviconBadge();
  }
}

export async function clearUnifiedBadge() {
  const ok = await tryClearAppBadge();
  if (!ok) clearFaviconBadge();
}
```

- **方針**：まず App Badging を試し、**成功したら favicon 更新はスキップ**（二重描画を避ける）。不発時のみ favicon を更新。

---

## イベント連携の例

- **通知 or サーバーからの新着**：Service Worker が push を受けたら、クライアントへ `postMessage({ type: 'NOTIFICATION_RECEIVED' })`。受信時に暫定的に `+1` したバッジを即時反映し、ストア同期後に正値で再設定。
- **タブ復帰**：`visibilitychange` で未読を再計算して `setUnifiedBadge(unreadCount)`。

```ts
// 受信側リスナー（クライアント）
useEffect(() => {
  const onMsg = (e: MessageEvent) => {
    if (e.data?.type === 'NOTIFICATION_RECEIVED') {
      setUnifiedBadge(Math.max(1, unread + 1));
    }
  };
  const onVis = () => {
    if (document.visibilityState === 'visible') setUnifiedBadge(unread);
  };
  navigator.serviceWorker?.addEventListener?.('message', onMsg as any);
  document.addEventListener('visibilitychange', onVis);
  onVis();
  return () => {
    navigator.serviceWorker?.removeEventListener?.('message', onMsg as any);
    document.removeEventListener('visibilitychange', onVis);
  };
}, [unread]);
```

---

## iOS / iPadOS の注意点（重要）

- **バッジ表示には通知許可が必要**（ホーム画面 Web アプリ）。許可前でも `setAppBadge()` は呼べるが、**許可が付与されるまでアイコン上に表示されない**。citeturn0search1

```ts
// 例：ユーザー操作にひもづけて許可をリクエスト
async function ensureNotificationPermission() {
  const p = await Notification.requestPermission();
  return p === 'granted';
}
```

---

## 既知の落とし穴 / 補足

- **Linux**：Chromium 系でも **OS レベルのアイコンバッジは表示されない**（API は存在しても実表示なし）。→ favicon バッジ必須。citeturn4search0
- **インストール要件**：Chrome/Edge は **インストール済み PWA** で動作。**Safari は Web アプリ（ホーム画面 / Dock）**で動作。ブラウザタブ内の通常ページでは効果がない。citeturn2search0turn3search4turn3search5
- **数値のサチュレーション**：OS/UA によっては `4000` を **`99+`** に丸める場合がある。大きな数はそのまま渡して OS に任せる。citeturn2search0

---

## 動作確認チェックリスト

1) **Chrome / Edge（Windows/macOS）**  
   - PWA をインストール → `navigator.setAppBadge(12)` がアイコンに反映される。citeturn2search0

2) **macOS Sonoma 以降の Safari**  
   - Safariで「ファイル > Dock に追加」で Web アプリ化 → バッジ表示を確認。citeturn3search5turn3search0

3) **iOS / iPadOS 16.4+**  
   - ホーム画面に追加 → `Notification.requestPermission()` で許可後、`setAppBadge` で表示。citeturn3search4

4) **Linux**  
   - `setAppBadge` を呼んでも OS アイコンにバッジが出ないことを確認（代わりに favicon バッジが効く）。citeturn4search0

---

## 参考資料

- WebKit Blog: *Badging for Home Screen Web Apps*（iOS/iPadOS 16.4 のサポート範囲と仕様） citeturn3search4  
- WebKit Blog: *WebKit Features in Safari 17.0*（macOS の Web アプリは badging をサポート） citeturn3search5  
- Apple サポート: *MacでSafari Webアプリを使う*（Dock 追加と未読バッジの説明） citeturn3search0  
- Chrome for Developers: *Badging for app icons*（Chrome/Edge の対応、Android の扱い） citeturn2search0  
- MDN: *Display a badge on the app icon*（Linux はバッジが表示されない） citeturn4search0  
- W3C WD: *Badging API*（仕様・インターフェイス） citeturn2search4

---

## 実装タスク（PR 用）

- [ ] `badge.ts` / `favicon-badge.ts` / `unified-badge.ts` を作成し、**`setUnifiedBadge`** を公開
- [ ] 通知ストア・既読処理・SW メッセージ受信箇所から **`setUnifiedBadge(unreadCount)`** を呼ぶ
- [ ] ルート（`Layout` など）に **バッジ更新リスナー**を設置（`visibilitychange` と SW `message`）
- [ ] E2E：Windows/macOS（Chrome/Edge/Safari）, iOS/iPadOS, Linux での表示確認
- [ ] ドキュメント（この md）を README からリンク

