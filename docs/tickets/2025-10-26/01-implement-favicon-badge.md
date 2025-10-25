# 通知時のファビコンバッジ実装

**Status**: 🔴 Not Started
**Priority**: 🔵 Medium
**Created**: 2025-10-26 06:26 JST
**Assignee**: 未定
**Estimated**: 1.5 days

## 概要

Web Push/In-app 通知を受信した際にブラウザタブのファビコンへ未読バッジを描画し、PWA Badge API が使えない環境でも未読が一目でわかるようにする。

## 目的

- Safari や Windows 版 Firefox など `navigator.setAppBadge` が未対応のブラウザ向けに視認性を補完する。
- Foreground で通知を受けた直後にサウンドだけでなく視覚的なフィードバックを提供する。
- 現行の未読カウント（`useNotificationsStore`）と Push 通知（`public/sw.js` → `NotificationSoundPlayer`）の流れを統合し、どの経路でもバッジ状態が同期されるようにする。

## 実装内容

- [ ] `lib/favicon-badge.ts` を新規追加し、以下を提供する:
  - `setupFaviconBadge(baseHref?: string)` で既存 `<link rel="icon">` をキャッシュ。
  - `drawFaviconBadge({ count })` で 64x64 canvas にベースアイコン + 赤バッジ (99+ 表示) を描画し、`link.href = canvas.toDataURL()` へ差し替え。
  - `clearFaviconBadge()` でオリジナル `href` 群へ復元。
- [ ] `lib/badge-api.ts` を `setUnifiedBadge(count)` にリネーム or ラッパ追加し、`setAppBadge` 成功時はそこで終了、未対応または失敗時に `setFaviconBadge(count)` をフェイルセーフで呼ぶ。
- [ ] `app/components/NotificationSoundPlayer.tsx` か、新規 `NotificationBadgeListener` クライアントを RootLayout に追加し、Service Worker の `NOTIFICATION_RECEIVED` メッセージをフックして `incrementPendingBadge()` を呼ぶ。
- [ ] `app/(board)/_stores/notifications-store.ts` 内の `setAppBadge` 呼び出しを新ユーティリティへ差し替え、既存の未読読み込み/既読処理/ポーリングでもバッジが確実にリセットされるようにする。
- [ ] ページの `visibilitychange` / `focus` を監視し、前景化時に `pendingBadge` を `unreadCount` と同期（タブに戻った瞬間に不要な赤丸が残らないようにする）。
- [ ] `docs/detail/notifications.md` にファビコンバッジの挙動と制約（ブラウザを閉じている場合は更新不可、Service Worker では DOM を触れない等）を追記。

## 技術的詳細

- ベースアイコンは `document.querySelector('link[rel="icon"]')` の `href` を取得し、1 度 Image オブジェクトへ読み込んでキャッシュする。Next.js が `/icon` エンドポイントで 512px PNG を返すため、`?size=64` を付けてダウンロードしておくと縮小 artefacts を避けられる。
- Canvas は 64px 正方形、`devicePixelRatio` を掛けた実サイズで作成し、描画後に 32/16 px へスケールした 2 種類の dataURL を `<link rel="icon" sizes="16x16">` と `<link rel="icon" sizes="32x32">` に配信する。
- バッジ描画は `count === 0` で完全復元、`count < 10` は円の中央に数字、`count >= 10` は `12px` フォントで `99+` を描く。文字が潰れる場合に備え、極小サイズ (16x16) では赤ドットのみ表示にフォールバックする。
- `NotificationSoundPlayer` とはロジックを分離し、同じ Service Worker メッセージを `window` customevent へ流すことで責務を分割する。
- `pendingBadgeCount` は `useRef` に保持し、`useNotificationsStore((s) => s.unreadCount)` を購読して差分を解消する。Push が届いた瞬間に UI ストアがまだ更新されていなくても視覚フィードバックを即出しできる。

## 受け入れ基準

- [ ] Chrome (Badge API 対応) で未読 3 件 → `navigator.setAppBadge(3)` が呼ばれ、ファビコンは切り替わらない。
- [ ] Safari/macOS で未読 3 件 → タブのファビコンに赤丸 + 数字が表示され、既読にすると元のアイコンへ戻る。
- [ ] Push 通知を受けた直後（未読 API 応答前）でもファビコンに赤丸が一時的に表示される。
- [ ] `Mark all read` 実行後 1 秒以内にファビコンが初期状態へ戻る。
- [ ] ページを閉じて再度開いた際、API から取得した未読件数に応じて初期状態が正しくセットされる。

## 関連チケット

- なし

## ノート

- Service Worker からは DOM を変更できないため、タブが完全に閉じられている時はファビコン更新不可。アプリがバックグラウンドで開かれている場合のみ機能する旨を UX コピーに追記する。
- Windows 版 Chrome など Badge API が有効な環境では無駄な canvas update を避けるため `setUnifiedBadge` 内部で明示的に `return true` したら favicon 更新をスキップする。
- long-lived canvas の data URL は 4KB 程度。複数サイズを更新する際は `requestAnimationFrame` でバッチし、不要な再描画を避ける。
