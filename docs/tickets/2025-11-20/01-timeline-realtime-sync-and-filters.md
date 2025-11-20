# 01 - Timeline UI リアルタイム同期とフィルター統合

## 概要
Timeline UI に Kanban UI から抽出した共通フックを統合し、リアルタイム同期、オフラインキュー、フィルター/検索機能を実装しました。また、ヘッダーをシンプル化し、ボード関連の機能のみを残しました。

## 実施日
2025-11-20

## 背景
Kanban UI から Timeline UI への移行プロジェクトの一環として、既存の機能を Timeline UI に移植する必要がありました。具体的には：
- リアルタイム同期（Supabase Realtime）
- オフライン同期（SyncQueue）
- 検索/フィルター機能
- ヘッダーの整理

## 実施内容

### 1. Timeline UI へのリアルタイム同期統合
**実施内容:**
- [`TimelineBoardPage.tsx`](file:///Users/yossydie/dev/taesk/app/(board)/_components/timeline/TimelineBoardPage.tsx) に `useRealtimeBoard` と `useSyncQueue` フックを統合
- カードの INSERT/UPDATE/DELETE イベントを処理する `handleCardChange` コールバックを実装
- `TimelineResponse` のデータ構造（`events` と `abBuckets`）を正しく更新

**技術的な詳細:**
- Supabase Realtime からのカード変更を Timeline のデータ構造に変換
- `due_channel` が `timeline` の場合は `events` 配列に追加/更新
- `due_channel` が `ab-list` の場合は `abBuckets` の該当バケットに追加/更新
- DELETE イベントでは両方の配列から削除

**関連ファイル:**
- [`app/(board)/_components/timeline/TimelineBoardPage.tsx`](file:///Users/yossydie/dev/taesk/app/(board)/_components/timeline/TimelineBoardPage.tsx#L374-L464)

### 2. フィルター & 検索機能の統合
**実施内容:**
- `useBoardFilters` フックを Timeline UI に統合
- ヘッダー内に検索バーとフィルターボタンを追加（後に別セクションに移動）
- Priority と Tag によるフィルタリング機能を実装
- `filteredData` を `useMemo` で計算し、パフォーマンスを最適化

**技術的な詳細:**
- `filterItem` 関数でイベントとバケットアイテムをフィルタリング
- 検索クエリ、選択されたタグ、優先度に基づいて表示データを動的にフィルタリング
- `allTags` を全イベント・バケットから抽出

**関連ファイル:**
- [`app/(board)/_components/timeline/TimelineBoardPage.tsx`](file:///Users/yossydie/dev/taesk/app/(board)/_components/timeline/TimelineBoardPage.tsx#L734-L779)
- [`app/(board)/_hooks/useBoardFilters.ts`](file:///Users/yossydie/dev/taesk/app/(board)/_hooks/useBoardFilters.ts)

### 3. サーバーサイドエラーの修正
**実施内容:**
- [`lib/server/boards.ts`](file:///Users/yossydie/dev/taesk/lib/server/boards.ts) で `createClient`（ブラウザ用）を `createServerSupabaseClient`（サーバー用）に置き換え
- サーバーサイドレンダリング時の 500 エラーを解消

**原因:**
- `createClient` はブラウザ環境の `document.cookie` に依存しており、サーバーサイドでは使用できなかった

**関連ファイル:**
- [`lib/server/boards.ts`](file:///Users/yossydie/dev/taesk/lib/server/boards.ts)

### 4. ヘッダーのシンプル化
**実施内容:**
- Timeline UI のヘッダーから Timeline 固有の要素を削除：
  - GMT+09、Today focus ラベル
  - 検索バー（別セクションに存在）
  - Filters ボタン（別セクションに存在）
- ボード関連の機能のみを残す：
  - Live バッジ
  - ボード名
  - Boards ▾ ドロップダウン
  - Share、通知ベル、Notify、プロフィール、Sign out

**設計判断:**
- Kanban UI と Timeline UI はそれぞれ異なるデザインコンセプトを持つため、完全な共通化は行わない
- 検索/フィルター機能は Timeline 専用のセクションに配置することで、UI の柔軟性を保つ
- ヘッダーはボード共通の機能のみを提供

**関連ファイル:**
- [`app/(board)/_components/timeline/TimelineBoardPage.tsx`](file:///Users/yossydie/dev/taesk/app/(board)/_components/timeline/TimelineBoardPage.tsx#L1513-L1582)

## 成果物

### 完了した機能
- ✅ Timeline UI でのリアルタイム同期（カード変更のリアルタイム反映）
- ✅ オフライン同期（SyncQueue）の統合
- ✅ 検索/フィルター機能（Tag、Priority）
- ✅ ヘッダーのシンプル化

### コミットログ
```
fix: correct supabase client usage in server-side board fetching
feat: integrate realtime sync and offline queue into Timeline UI
feat: integrate filters and search into timeline UI
refactor: simplify timeline header by removing timeline-specific elements
```

## 技術的な課題と解決策

### 課題 1: Realtime イベントのデータ変換
**問題:** Supabase Realtime から受け取る `Card` オブジェクトを `TimelineEvent` や `TimelineBucketItem` に変換する必要があった

**解決策:**
- `due_channel` フィールドで配置先を判定
- `due_date`/`due_start`/`due_end` から Timeline 用のフィールドを生成
- バケット内のアイテムは `due_bucket_position` でソート

### 課題 2: フィルタリングのパフォーマンス
**問題:** イベントとバケットアイテムを毎回フィルタリングするとパフォーマンスが低下

**解決策:**
- `useMemo` でフィルタリング結果をキャッシュ
- 依存配列に `data`, `searchQuery`, `selectedTags`, `selectedPriority` を指定
- 不要な再計算を防止

### 課題 3: ヘッダーの共通化
**問題:** Kanban と Timeline でヘッダーのデザインコンセプトが異なる

**解決策:**
- 完全な共通化は避け、それぞれのUIに最適化された形を保つ
- 将来的に必要であれば、小さな共通コンポーネント（`BoardSwitcher`, `UserActions` など）を作成

## 残タスク

チケット [`00-timeline-default-board.md`](file:///Users/yossydie/dev/taesk/docs/tickets/2025-11-19/00-timeline-default-board.md) より：

| タスク | ステータス |
|--------|-----------|
| 共通ロジックの抽出 (Hooks化) | ✅ 完了 |
| ヘッダーコンポーネントの統合・共通化 | ⚠️ スキップ（それぞれに最適化） |
| コメント/メンバー導線の復活 + CardModal | 要確認 |
| フィルター/検索の適用 | ✅ 完了 |
| リアルタイム同期 & オフライン同期の適用 | ✅ 完了 |
| Playwright テストの拡充 | ⬜ 未着手 |
| ドキュメント更新 | ⬜ 未着手 |
| 最終 E2E 実行 & サマリー反映 | ⬜ 未着手 |

## 次のステップ

1. **コメント/メンバー導線の確認**
   - Timeline UI でコメントパネルの開閉が正しく動作するか確認
   - メンバー管理の導線が適切に表示されているか確認

2. **テストの拡充**
   - `e2e/timeline.spec.ts` にリアルタイム同期のテストを追加
   - フィルター機能のE2Eテストを追加

3. **ドキュメント更新**
   - タイムラインUIがデフォルトになったことを反映
   - 新しいフィルター機能の使い方をドキュメント化

## メモ

- モーダル開閉時の遅延について: `handleCardChange` の不要な変数宣言を削除して最適化済み
- 検索/フィルターUIはユーザーの要望により、ヘッダーから別セクションに分離
