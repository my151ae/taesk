# Taesk - Timeline Board Documentation

> Team 配下の Board 上で Today/Tomorrow の時間軸と A/B リストをひとつのビューで計画できる Next.js + Supabase 製 Timeline ボード

## UI Scope

現在の運用 UI は **Timeline + A/B リスト** のみ。`/b/...` ルートでは Kanban 画面は使用しない。
- 左パネル機能は別ページへ逃がさず、既存の `/b/...` 画面内で完結させることをデフォルトとする。
- board navigation / URL state の canonical contract は strict `lp` / `rp` を使い、`lp` は left section、`rp` は right panel mode のみを表す。
- desktop / mobile は visible UI が違っていても、board navigation の state/URL model は同じ `BoardUiState` を共有する。
- `date` query は desktop では左端日、mobile では中央 pane の anchor day を表す。mobile の scroll restore は URL ではなく in-memory state を使う。
- canonical default は `lp=overdue&rp=timeline` とし、invalid URL の reset 先も同一 canonical URL とする。
- `Search` / `Overdue` / `Tags` は left self-contained とし、右パネルの `Timeline` / `List` は left context から独立して切り替える。
- 右パネル上部は「1段目=レイアウト種別」「2段目=その機能専用メニュー」の 2 段を共通パターンとする。

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture Overview](#architecture-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Detailed Documentation](#detailed-documentation)
- [Key Design Decisions](#key-design-decisions)
- [Quick Links](#quick-links)

## 🚀 Quick Start

> ⚠️ **最優先ルール**: `npm run dev` や `NODE_ENV=test npm run dev` を手動で実行しない。検証は Playwright JSON レポートと chrome-devtools MCP で行う。

```bash
# Install dependencies
npm install

# Prepare env files
cp .env.example .env.local
cp .env.example .env.test
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY などを設定

# Static analysis
npm run lint

# Production bundle
npm run build

# Verification (JSON レポート必須)
npx playwright test --reporter=json > test-results/playwright-report.json
cat test-results/playwright-report.json | jq '.stats'
```

UI のレンダリング確認は chrome-devtools MCP のスクリーンショット/スナップショット/ログ取得で行う。Next.js の dev サーバーを直接起動して確認しない。

### 🔊 Notification Sound Check

1. Timeline ヘッダーの `NotificationSettings` セクションで **「音声を有効化」** をクリックし、Web Audio の `AudioContext` をアンロック
2. **「🎵 テスト音を再生」** を押し、800Hz / 200ms フェードアウトのビープ音が鳴ることを確認
3. Service Worker 経由の通知を検証する場合は `showTestNotification()` を発火し、前景タブでは `NotificationSoundPlayer` がビープを鳴らし、背景タブでは OS 標準通知音のみ鳴ることをログで確認

ビープ生成は `lib/notification-audio.ts` の Web Audio 実装に統一されている。旧 Kanban 時代の data URL 音源は使用しない。

### Running E2E Tests

**前提**: `.env.test` に Supabase の anon key / service-role key / E2E ユーザー資格情報を設定する。Playwright 実行時は常に `PW_WORKERS=1`。

```bash
# 各バッチの単体実行（失敗しているバッチを優先）
npm run test:auth
npm run test:timeline
npm run test:comments
npm run test:notifications
npm run test:permissions
npm run test:reorder
npm run test:rls

# すべてのバッチを順番に実行し JSON を収集
npm run test:all-split

# JSON サマリー確認
sed -n '/^{/,$p' test-results/playwright-report.json | jq '.stats'
```

生成されるアーティファクト:
- `test-results/batches/<timestamp>-<batch>.json` … `scripts/test-all-batches.sh` が自動で保存
- `test-results/logs/batch-execution-*.log` … バッチごとの標準出力
- `test-results/artifacts/` … 失敗時のスクリーンショット・トレース
- `playwright/.auth/user.json` … Supabase 認証セッション (使い回し可)

**バッチ構成 (2025-11-20 時点 / 計 7)**  
| バッチ | 含まれる spec | 主な検証観点 |
| --- | --- | --- |
| auth | `e2e/auth.spec.ts` | Supabase OAuth, session refresh |
| timeline | `e2e/timeline.spec.ts` | Today/Tomorrow カラム描画、A/B リスト所属、`dumpClientMetrics('timeline')` |
| comments | `e2e/comments.spec.ts` | CardModal コメントタブ、@mentions、Realtime 反映 |
| notifications | `e2e/notifications.spec.ts` | NotificationSettings, quiet hours, Web Push |
| reorder | `e2e/reorder-api.spec.ts` | API レベルの position validation, ロールバック |
| permissions | `e2e/board-permissions.spec.ts` | ShareDialog, member roles, invites |
| rls | `e2e/rls.spec.ts` | RLS policy での強制アクセス制御 |

`timeline` バッチは Timeline UI が **day_range（デフォルト2日 / 最大7日）+ A/B** を 1 分粒度でレンダリングできるか、および `createClientTrace('timeline')` からメトリクスが送出されるかを確認する。タイムアウトが発生した場合は個別に `PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/batches/<timestamp>-timeline.json npx playwright test e2e/timeline.spec.ts --project=core --reporter=json` を実行し、問題を切り分けてから `npm run test:all-split` を再開する。

## 🏗️ Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                   TimelineBoardPage (client)                 │
│  - day_range 分のカラム (24h * 40px, 1-7日)                  │
│  - A/B リスト (YYYY-MM-DD_a/b)                               │
│  - Team switcher + board selector + Share/Notifications      │
│  - CardModal / CommentsPanel (parallel routes)               │
└──────────────┬───────────────────────────────────────────────┘
               │ suspense + optimistic updates
┌──────────────▼───────────────────────────────────────────────┐
│                    Timeline Hooks & Stores                    │
│  useRealtimeBoard  useSyncQueue  useBoardFilters  comments store│
│        │                │                │                     │
│        └─────┬──────────┴──────────┬─────┘                     │
└──────────────▼─────────────────────▼───────────────────────────┘
               │ timeline response (days, events, abBuckets)
┌──────────────▼───────────────────────────────────────────────┐
│             API Routes & Server Utilities                     │
│  GET /api/boards/:id/timeline  (start/range + A/B)            │
│  POST /api/cards/* /comments/* (shared CRUD)                  │
│  createClientTrace('timeline') / createServerTrace('timeline')│
└──────────────┬───────────────────────────────────────────────┘
               │ Supabase client (SSR + browser)
┌──────────────▼───────────────────────────────────────────────┐
│                       Supabase (Postgres)                     │
│  cards.due_start / due_end / due_bucket / due_bucket_position │
│  teams / team_members / board_members + RLS + realtime       │
└──────────────────────────────────────────────────────────────┘
```

### Timeline Response

`GET /api/boards/[boardId]/timeline` は以下の JSON を返す:

```ts
interface TimelineDay {
  key: string;        // YYYY-MM-DD
  label: string;      // "Today" / "Tomorrow" / "MM/DD (Wed)" など
  isoDate: string;    // JST YYYY-MM-DD
}

interface TimelineEvent {
  card_id: string;
  due_date: string;
  due_start: string | null; // HH:MM:SS
  due_end: string | null;
  durationMinutes: number | null;
  title: string;
  tags: string[];
  checked: boolean;
  due_bucket?: 'a' | 'b' | null;
  due_bucket_position?: number | null;
  assignee_id?: string | null;      // legacy single
  assignee_ids?: string[] | null;   // current multi-assign
  assigned_to?: string | null;      // legacy alias
  short_id: string | null;
  slug: string | null;
}

type TimelineBuckets = Record<string, TimelineBucketItem[]>; // key = `${isoDate}_a` / `${isoDate}_b`

interface TimelineOverdueItem {
  card_id: string;
  due_date: string | null;
  due_start: string | null;
  due_end: string | null;
  due_bucket?: 'a' | 'b' | null;
  due_bucket_position?: number | null;
  title: string;
  checked: boolean;
  short_id: string | null;
  slug: string | null;
}
```

- `due_date` があり `due_start`/`due_end` が **両方ある** カードは Timeline イベントとして並び、`durationMinutes` を算出する
- `due_date` があり `due_start`/`due_end` が **未設定** のカードは A/B に入り、`due_bucket`（未指定なら `b`）でグルーピングされる
- `due_date` が過去日かつ `checked = false` のカードは visible range に関係なく `overdue` に入り、visible range 内では `events` / `abBuckets` にも重複して出る
- A/B は `due_bucket_position` で降順ソート
- `assignee_ids` を含めて返却し、ドラッグや楽観更新でもローカル状態から消えないように保持する（再フェッチ待ちの間もメンバー表示を維持）
- API は Team 配下の認証済みボードメンバーのみアクセス可能で、最終的な判定は `board_members` テーブルに存在しない場合 403 を返す
- `board_members` は Team member の subset として扱い、Team 未所属ユーザーへ Board access を直接付与しない

Canonical type definitions: `lib/api-types/timeline.ts`（クライアント/サーバー/ドキュメントで共通参照）

### TimelineBoardPage の主な処理

- `createClientTrace('timeline')` を `useEffect` で起動し、ロード時間・描画イベント数・D&D 回数などを JSON で送信
- `@dnd-kit/core` による DragStart/DragMove/DragEnd を定義し、A/B ⇄ Timeline の移動で `due_bucket` / `due_start` / `due_end` を再計算
- `useRealtimeBoard` が Supabase Realtime の UPDATE/INSERT/DELETE を購読し、`TimelineEvent` / `abBuckets` へ変換
- `CardModal` / `CommentsPanel` は URL (`?card=SHORTID` や `/c/SHORTID`) からでも開閉でき、Parallel Routes 経由でモーダル表示

## ✨ Features

### Timeline Planning
- 🕒 **Timeline (1-7日)**: 24h × 40px のスケールで 1 分単位の予定ブロックを可視化（デフォルトは Today/Tomorrow の2日）
- 📱 **Mobile Timeline Rail**: モバイルでは 1 日全幅の 3 ペイン横レールで前日/当日/翌日を先読みし、日付ヘッダーより下だけを横スクロールする
- 🅰️ **A/B Buckets**: `YYYY-MM-DD_a/b` にカードを割り当て、日ごとのタスク整理を行う
- 🔁 **Drag & Drop**: Timeline ⇄ A/B 間の移動、時間軸上でのリサイズ/再配置を DnD Kit でサポート
- 📍 **Live Indicator**: JST 基準の Now ラインと「Live」バッジで現在時刻を強調
- 👓 **Filters & Search**: タグ/優先度/テキストフィルターをヘッダーに表示し、Timeline と A/B 同時に絞り込み

### Collaboration & Editing
- 💬 **CardModal + CommentsPanel**: Timeline から直接モーダルを開き、詳細・チェックリスト・コメント・@mentions を編集
- 🔔 **Notifications**: NotificationSettings + NotificationsBell で通知音、quiet hours、Web Push を制御
- 👥 **Board Header**: Team switcher / board selector / ShareDialog / profile menu を Timeline ヘッダーへ統合
- ✍️ **Due Editor**: CardModal や Timeline DnD から `due_start`, `due_end`, `due_bucket` を編集

### Data Integrity & Observability
- ⛳ **due_* Fields**: `due_start`, `due_end`, `due_bucket`, `due_bucket_position` をカードテーブルに追加し、時間あり/なしで Timeline と A/B を分岐
- 📡 **Realtime + Offline Queue**: `useRealtimeBoard` が Supabase Realtime を購読、`useSyncQueue` が失敗時にロールバック
- 📊 **Client Metrics**: `createClientTrace('timeline')` でロード時間・D&D 操作数を収集し、`docs/spec/architecture.md` で可視化ルールを管理
- 🔐 **RLS**: Supabase RLS が Team 配下の Board access を前提に、`board_members` を正本としてカードアクセスを制限

### Testing & Reliability
- 🧪 **Playwright JSON Pipeline**: `npm run test:all-split` が 7 バッチを順番に実行し、`test-results/batches/*.json` を生成
- ⚠️ **Flaky Handling**: Comments バッチで発生しがちな `Unexpected end of JSON input` を個別再実行→集計
- 🔂 **Rollback Paths**: `handleDragEnd` などでエラー時に前状態 (`previousState`) へ戻し、データ破壊を防止

## 🛠️ Tech Stack

- **Framework**: Next.js 16 (App Router, Parallel Routes, Server Components)
- **UI**: React 18 + Tailwind CSS 3
- **Timeline Rendering**: Custom components + `@dnd-kit/core`
- **State**: React hooks + Zustand stores (comments, notifications)
- **Backend**: Supabase (PostgreSQL + Auth + Realtime + Edge Functions)
- **Storage**: Supabase + localStorage + offline sync queue
- **Language**: TypeScript 5
- **Testing**: Playwright 1.56 (JSON reporter必須)
- **Deployment**: Vercel (Node.js runtime, `npm run build`)

## 📁 Project Structure

```
taesk/
├── app/
│   ├── board/page.tsx                # 所属ボードを検索し正規URL (/b/...) へリダイレクト
│   ├── (board)/
│   │   ├── page.tsx                  # / → /board へ permanentRedirect
│   │   ├── layout.tsx                # Parallel Routes (@modal) と AuthContext
│   │   ├── _components/
│   │   │   ├── timeline/TimelineBoardPage.tsx  # Timeline UI 本体
│   │   │   ├── Card/Notification/Share など共通 UI
│   │   ├── _hooks/                     # useRealtimeBoard, useSyncQueue, useBoardFilters
│   │   ├── _stores/                    # comments-store など
│   │   ├── @modal/(...)c/[short_id]/[[...slug]]/page.tsx  # Timeline からカードモーダルを開く
│   │   └── b/[short_id]/[[...slug]]/page.tsx             # メイン描画エントリーポイント (TimelineBoardPage)
│   ├── api/boards/[boardId]/timeline/route.ts  # Timeline API
│   ├── api/cards/* / comments/* / notifications/*        # CRUD + sync API
│   ├── components/CardModal.tsx          # 共通カードモーダル
│   └── contexts/AuthContext.tsx          # Supabase セッション管理
│
├── lib/
│   ├── supabase.ts                      # Browser/Server client + Card/Board 型定義
│   ├── metrics/{client,server}.ts       # createClientTrace/createServerTrace
│   ├── board-url.ts / card-url.ts       # Timeline カード URL utils
│   ├── board-defaults.ts                # MAIN_BOARD_ID など
│   └── server/*                         # SSR 用 fetch ヘルパー
│
├── e2e/
│   ├── timeline.spec.ts                 # Timeline 表示 + メトリクス検証
│   ├── comments.spec.ts / notifications.spec.ts / ...    # 他バッチ
│   └── utils/metrics.ts                 # dumpClientMetrics, createTrace helpers
│
├── docs/                                # 本ドキュメント + spec/
├── scripts/test-all-batches.sh          # PW_WORKERS=1 でバッチ実行
├── test-results/                        # JSON レポートとログ
└── supabase/migrations/                 # due_* フィールド等の SQL
```

## 📚 Detailed Documentation

- [Architecture & Design](./spec/architecture.md)
- [Design & Responsive Guidelines](./spec/design-guidelines.md)
- [Keyboard Navigation](./spec/keyboard-navigation.md) - CardModal のタイトル/本文境界は矢印移動のみ
- [Tiptap Details / Toggle](./spec/tiptap-details-toggle.md) - CardModal 本文のトグル仕様と責務境界
- [Tiptap Block Action Testing](./spec/tiptap-block-action-testing.md) - 本文 block action の E2E 観測と autosave 検証メモ
- [Domain Model](./spec/domain-model.md)
- [Component Breakdown](./spec/components.md)
- [Database Schema](./spec/database.md)
- [Storage Strategy](./spec/storage.md)
- [Routing & Modal Flow](./spec/routing.md)
- [Notifications & Audio](./spec/notifications.md)
- [Supabase MCP 認証手順](./spec/supabase-mcp-auth.md)
- [Testing Playbook](./spec/testing.md)
- [Deployment Guide](./spec/deployment.md)
- [Setup Guide](./spec/local-dev.md)

## 🎯 Key Design Decisions

1. **Timeline-First UI**  
   Kanban レイアウトを廃止し、**デフォルト2日（Today/Tomorrow）〜最大7日**の Timeline と A/B リストを 1 ページで扱う UI を唯一の正史とした。Now ラインや日付ナビを基点に最短で日次計画へアクセスできる。

2. **due_* Fields & Timeline/A-B 分岐**  
   `due_start` / `due_end` の有無で Timeline or A/B を分岐し、A/B は `due_bucket` + `due_bucket_position` で制御。サーバーで整合性を担保する。

3. **JST Canonical Time**  
   API と UI はすべて JST (+09:00) を基準に日付計算する。`GET /timeline` は day_range (1-7日) の範囲を JST で算出し、クライアントも `getIsoDateJst` を利用して一貫性を保つ。

4. **Parallel Routes for Card Modal**  
   `/@modal/(...)c/[short_id]/[[...slug]]` を用い、Timeline でカードを開いても背後のボード状態を維持。URL 直アクセスでも同じモーダルが開く。

5. **Realtime + Offline Sync Pipeline**  
   Timeline 操作は `useSyncQueue` でキューイング→API→ロールバックし、別タブ更新は `useRealtimeBoard` で即座に反映。`createClientTrace('timeline')` で操作回数を計測し、Flaky 原因を追跡。

6. **JSON-Only Testing Flow**  
   Playwright は常に `--reporter=json` で実行し、`test-results/batches/*.json` をチケットへ添付。HTML レポートは `npx playwright show-report --port=0` で必要時のみ起動し、プロセスを残さない。

7. **CardModal Boundary Has Explicit Title Body Bridge Rules**  
   CardModal のタイトル入力欄と本文エディタの間では、`ArrowDown` / `ArrowRight` / `ArrowUp` / `ArrowLeft` のフォーカス移動を持つ。タイトル欄の通常の `Enter` は本文1行目へ標準 paragraph を追加して本文へ移し、本文先頭行頭の `Backspace` は空の top-level paragraph だけ削除してタイトル末尾へ戻す。その他の先頭行では本文を変更せずタイトル末尾へ戻す。IME 確定中の `Enter` は移動しない。

8. **Shortcut Taxonomy Is Layer-First**  
   shortcut の分類は `scope / region / section / view / part / state` を正本とし、`scope` は `board | modal | context-menu` のレイヤー専用に固定する。`ShortcutsModal` は独立 scope ではなく `scope=modal, region=shortcuts-modal` として扱う。

## 🔗 Quick Links

- [docs/spec/architecture.md](./spec/architecture.md)
- [docs/spec/keyboard-navigation.md](./spec/keyboard-navigation.md)
- [docs/spec/shortcut-taxonomy.md](./spec/shortcut-taxonomy.md)
- [docs/spec/tiptap-details-toggle.md](./spec/tiptap-details-toggle.md)
- [docs/spec/tiptap-block-action-testing.md](./spec/tiptap-block-action-testing.md)
- [docs/spec/testing.md](./spec/testing.md)
- [Supabase Docs](https://supabase.com/docs)
- [MVP Priorities](./spec/mvp-priorities.md)
- [Next.js Docs](https://nextjs.org/docs)

## 📝 License

Taesk は社内用プロジェクトとして運用している。外部配布は想定していないため、利用範囲や再配布は管理者の指示に従うこと。
