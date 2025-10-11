# Taesk Roadmap

## Current Version: v0.1.0

Last Updated: 2025-10-10

---

## ✅ 完了済み機能 (v0.1.0)

### Core Features
- ✅ Kanban board基本機能（リスト・カード管理）
- ✅ Drag & drop（リスト間・カード間）
- ✅ Supabase統合（PostgreSQL）
- ✅ localStorage cache（オフライン対応）
- ✅ PWA対応（モバイルインストール可能）
- ✅ モバイルレスポンシブデザイン

### Authentication & Security
- ✅ Google OAuth認証（Supabase Auth）
- ✅ 共有ボードアーキテクチャ（全認証ユーザーが協働）
- ✅ RLS (Row Level Security) ポリシー実装
- ✅ マルチボード対応（ユーザーごとのボード作成・管理）

### Real-time & Offline
- ✅ Supabase Realtimeによるライブ同期
- ✅ オフライン同期キュー（localStorage）
- ✅ オンライン/オフライン状態表示
- ✅ 同期ステータス表示（Live/Queued）

### Testing & Documentation
- ✅ E2Eテスト（Playwright）26 tests passing
  - Authentication tests (5)
  - Kanban board tests (13)
  - RLS policy verification (8)
- ✅ Programmatic sign-in for E2E tests
- ✅ 完全なドキュメント (`/docs`)

---

## Phase 1: Core Enhancements (v0.2.0) - 🟢 ほぼ完了

**目的**: ユーザー体験の向上とデータの安全性

| # | 機能 | Status | Priority | 概要 |
|---|------|--------|----------|------|
| 1.1 | 認証システム | 🟢 完了 | 🔥 High | Google OAuth認証、共有ボード設計 |
| 1.2 | リアルタイム同期 | 🟢 完了 | 🔥 High | Supabase Realtimeで複数デバイス間のライブ更新 |
| 1.3 | オフライン同期キュー | 🟢 完了 | 🔵 Medium | オフライン時の変更をキュー保存、オンライン復帰時に自動同期 |
| 1.4 | マルチボード対応 | 🟢 完了 | 🔵 Medium | 複数ボード作成・管理、ボード切り替え |

---

## Phase 2: Feature Expansion (v0.3.0)

**目的**: 機能の拡充と使いやすさの向上

| # | 機能 | Status | Priority | 概要 |
|---|------|--------|----------|------|
| 2.1 | カード機能拡張 | 🟢 完了 | 🔵 Medium | タグ/ラベル、期限設定、優先度、担当者（アサイニー）機能 |
| 2.2 | 検索・フィルター | 🟢 完了 | 🔵 Medium | カード全文検索、タグ/ラベルフィルタ、期限ソート |
| 2.3 | アクティビティログ | 🟢 完了 | ⚪ Low | カード/リスト変更履歴、誰がいつ何を変更したか記録、アクティビティフィード |
| 2.4 | ボード間カード移動 | 🟢 完了 | ⚪ Low | ボード間でカードを移動（編集UIから） |
| 2.5 | URL Routing & Modal | 🟢 完了 | 🔵 Medium | Trello風カードURL、Intercepting Routes、モーダル/スタンドアロン表示 |

---

## Phase 3: Collaboration (v0.4.0)

**目的**: チーム機能の追加

| # | 機能 | Status | Priority | 概要 |
|---|------|--------|----------|------|
| 3.1 | ボード共有権限 | 🔴 未着手 | 🔵 Medium | ボードごとの閲覧/編集権限設定、招待リンク生成 |
| 3.2 | コメント機能 | 🔴 未着手 | ⚪ Low | カードへのコメント、@メンション通知、コメントスレッド |
| 3.3 | 通知システム | 🔴 未着手 | ⚪ Low | カード変更通知、@メンション、期限リマインダー、PWAプッシュ通知 |

---

## Phase 4: Advanced Features (v0.5.0)

**目的**: 高度な機能の追加

| # | 機能 | Status | Priority | 概要 |
|---|------|--------|----------|------|
| 4.1 | カスタムフィールド | 🔴 未着手 | ⚪ Low | カードに任意フィールド追加、フィールドタイプ（テキスト、数値、日付、選択肢） |
| 4.2 | オートメーション | 🔴 未着手 | ⚪ Low | ルールベース自動化、トリガー（カード移動、期限到達）、アクション（通知、タグ追加） |
| 4.3 | テンプレート機能 | 🔴 未着手 | ⚪ Low | ボード/カードテンプレート、よく使うセットアップ保存 |
| 4.4 | インポート/エクスポート | 🔴 未着手 | ⚪ Low | JSON/CSV形式、Trelloからインポート |

---

## Phase 5: Performance & Scale (v0.6.0)

**目的**: パフォーマンス最適化とスケーラビリティ

| # | 機能 | Status | Priority | 概要 |
|---|------|--------|----------|------|
| 5.1 | 仮想スクロール | 🔴 未着手 | 🔵 Medium | 大量カードでもスムーズ表示、遅延読み込み |
| 5.2 | 画像アップロード | 🔴 未着手 | 🔵 Medium | カードに画像添付、Supabase Storage連携、プレビュー |
| 5.3 | アーカイブ機能 | 🔴 未着手 | ⚪ Low | 完了カードのアーカイブ、検索・復元機能 |

---

## Backlog (アイデア段階)

優先度未定のアイデア:

- ダークモードのカスタマイズ
- キーボードショートカット
- モバイルアプリ（React Native）
- デスクトップアプリ（Electron）
- REST API公開
- Webhooks
- Zapier/Slack連携
- ガントチャート表示
- カレンダービュー
- タイムトラッキング
- レポート/分析機能

---

## 📝 完了履歴

### 2025-10-11
- ✅ **Phase 2.5 Complete** - Trello風カードURL & モーダル表示機能完成
- ✅ **Intercepting Routes** - Next.js 15の最新機能を活用（`(.)c` パターン確立）
- ✅ **Card URLs** - Short ID + SEO-friendly slug対応、多言語slug対応
- ✅ **Modal View** - ボードからクリックでモーダル表示、Close/Escで戻る
- ✅ **Standalone Page** - 直接URL入力でフルページ表示、共有可能
- ✅ **308 Redirect** - Canonical URL正規化でSEO最適化
- ✅ **Documentation** - `/docs/detail/routing.md` 追加、実装詳細を完全ドキュメント化

### 2025-10-10
- ✅ **E2E Test Stability** - Phase 3完了（Programmatic Sign-in実装）
- ✅ **Data Isolation Tests** - 不要なテストを削除、共有ボード設計を明確化
- ✅ **26/26 Tests Passing** - 全E2Eテストが安定して通過

### 2025-10-09
- ✅ **E2E Test Suite** - Playwright統合、全機能カバレッジ達成
- ✅ **Documentation** - `/docs` 配下に完全なドキュメント体系を構築
- ✅ **Ticket System** - `tickets/` ディレクトリとルール作成
- ✅ **Card Movement Fix** - リスト間移動の保存処理を修正

---

## 📊 ステータス・優先度凡例

### Status
- 🟢 **完了** - Completed
- 🟡 **進行中** - In Progress
- 🔴 **未着手** - Not Started
- 🔵 **ブロック中** - Blocked
- ⚫ **キャンセル** - Cancelled

### Priority
- 🔥 **High** - 最優先・早急に実装
- 🔵 **Medium** - 中優先・計画的に実装
- ⚪ **Low** - 低優先・余裕があれば

---

## 🎯 次のステップ

### 短期（v0.2.0リリース準備）
1. ✅ Phase 1完了確認 - **完了**
2. バグ修正・UX改善
3. パフォーマンステスト
4. v0.2.0リリース

### 中期（Phase 2-3）
1. **Phase 2: Feature Expansion**
   - カード機能拡張（タグ、期限、優先度）
   - 検索・フィルター機能

2. **Phase 3: Collaboration**
   - ボード共有権限管理
   - コメント機能

### 長期（Phase 4-5）
1. カスタムフィールド、オートメーション
2. パフォーマンス最適化（仮想スクロール）
3. 画像アップロード機能

---

## 📌 備考

- ロードマップは柔軟に変更可能
- ユーザーフィードバックに応じて優先度を調整
- 各機能の詳細は個別チケット（`/docs/tickets/YYYY-MM-DD/`）で管理
