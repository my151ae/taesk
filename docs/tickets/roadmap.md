# Taesk Roadmap

## Overview

このドキュメントはTaeskの機能追加・改善のロードマップです。

## Current Status (v0.1.0)

✅ **完了済み**:
- Kanban board基本機能
- Drag & drop (lists & cards)
- Supabase統合
- localStorage cache
- PWA対応
- モバイルレスポンシブ
- E2Eテスト
- 完全なドキュメント

## Roadmap

### Phase 1: Core Enhancements (v0.2.0)

**目的**: ユーザー体験の向上とデータの安全性

#### 1.1 認証システム 🔥 High Priority

- [2025-10-09/1430-add-authentication.md](./2025-10-09/1430-add-authentication.md)
- Supabase Authによるログイン機能
- メールアドレス/パスワード認証
- ソーシャルログイン（Google, GitHub）
- ユーザーごとのデータ分離

#### 1.2 リアルタイム同期 🔥 High Priority

- [2025-10-09/1432-implement-realtime-sync.md](./2025-10-09/1432-implement-realtime-sync.md)
- Supabase Realtimeによるライブ更新
- 複数デバイス間でのリアルタイム同期
- 競合検出と解決

#### 1.3 オフライン同期キュー 🔵 Medium Priority

- [2025-10-09/1435-add-offline-sync-queue.md](./2025-10-09/1435-add-offline-sync-queue.md)
- オフライン時の変更をキューに保存
- オンライン復帰時に自動同期
- 同期ステータスインジケーター

### Phase 2: Feature Expansion (v0.3.0)

**目的**: 機能の拡充と使いやすさの向上

#### 2.1 カード機能拡張 🔵 Medium Priority

- [2025-10-09/1440-add-card-metadata.md](./2025-10-09/1440-add-card-metadata.md)
- タグ/ラベル機能
- 期限設定
- 優先度設定
- アサイニー（担当者）

#### 2.2 マルチボード対応 🔵 Medium Priority

- [2025-10-09/1445-implement-multiple-boards.md](./2025-10-09/1445-implement-multiple-boards.md)
- 複数のボードを作成・管理
- ボード間でのカード移動
- ボードのテンプレート機能

#### 2.3 検索・フィルター 🔵 Medium Priority

- [2025-10-09/1450-add-search-and-filter.md](./2025-10-09/1450-add-search-and-filter.md)
- カードの全文検索
- タグ/ラベルでフィルタリング
- 期限でソート

#### 2.4 アクティビティログ ⚪ Low Priority

- [2025-10-09/1455-add-activity-log.md](./2025-10-09/1455-add-activity-log.md)
- カード/リストの変更履歴
- 誰がいつ何を変更したか記録
- アクティビティフィード

### Phase 3: Collaboration (v0.4.0)

**目的**: チーム機能の追加

#### 3.1 ボード共有 🔵 Medium Priority

- [2025-10-09/1500-implement-board-sharing.md](./2025-10-09/1500-implement-board-sharing.md)
- ボードを他のユーザーと共有
- 閲覧/編集権限の設定
- 招待リンク生成

#### 3.2 コメント機能 ⚪ Low Priority

- [2025-10-09/1505-add-comments.md](./2025-10-09/1505-add-comments.md)
- カードへのコメント
- @メンションで通知
- コメントスレッド

#### 3.3 通知システム ⚪ Low Priority

- [2025-10-09/1510-implement-notifications.md](./2025-10-09/1510-implement-notifications.md)
- カード変更の通知
- @メンション通知
- 期限リマインダー
- プッシュ通知（PWA）

### Phase 4: Advanced Features (v0.5.0)

**目的**: 高度な機能の追加

#### 4.1 カスタムフィールド ⚪ Low Priority

- カードに任意のフィールド追加
- フィールドタイプ（テキスト、数値、日付、選択肢）
- カスタムビュー

#### 4.2 オートメーション ⚪ Low Priority

- ルールベースの自動化
- トリガー: カード移動、期限到達など
- アクション: 通知、タグ追加など

#### 4.3 テンプレート機能 ⚪ Low Priority

- ボードテンプレート
- カードテンプレート
- よく使うセットアップを保存

#### 4.4 インポート/エクスポート ⚪ Low Priority

- JSON形式でエクスポート
- Trello形式からインポート
- CSV形式対応

### Phase 5: Performance & Scale (v0.6.0)

**目的**: パフォーマンス最適化とスケーラビリティ

#### 5.1 仮想スクロール

- 大量のカードでもスムーズな表示
- リスト/カードの遅延読み込み

#### 5.2 画像アップロード

- カードに画像添付
- Supabase Storageと連携
- 画像プレビュー

#### 5.3 アーカイブ機能

- 完了したカードをアーカイブ
- アーカイブの検索・復元

## Completed Tickets

### 2025-10-09

- ✅ [1400-fix-card-move-save.md](./2025-10-09/1400-fix-card-move-save.md) - カード移動の保存修正
- ✅ [1405-add-e2e-tests.md](./2025-10-09/1405-add-e2e-tests.md) - E2Eテスト追加
- ✅ [1410-create-documentation.md](./2025-10-09/1410-create-documentation.md) - ドキュメント作成

## Backlog

アイデア段階のタスク:

- ダークモードテーマのカスタマイズ
- キーボードショートカット
- モバイルアプリ（React Native）
- デスクトップアプリ（Electron）
- API公開
- Webhooks
- Zapier/Slack連携

## Decision Log

### なぜSupabase Realtimeを優先するか

- 複数デバイス間の同期はユーザー要望が高い
- 技術的に実装可能（Supabaseが提供）
- オフラインファーストと両立可能

### なぜマルチボードをPhase 2にするか

- まずは単一ボードの完成度を高める
- 認証が必須（ボードの所有者管理）
- データベース設計の変更が必要

## Version History

| Version | Release Date | Status | Features |
|---------|-------------|--------|----------|
| v0.1.0 | 2025-10-09 | ✅ Released | MVP - Basic Kanban, Supabase, PWA |
| v0.2.0 | TBD | 🔴 Planned | Auth, Realtime, Offline sync |
| v0.3.0 | TBD | 🔴 Planned | Card metadata, Multi-board, Search |
| v0.4.0 | TBD | 🔴 Planned | Sharing, Comments, Notifications |
| v0.5.0 | TBD | 🔴 Planned | Custom fields, Automation |
| v0.6.0 | TBD | 🔴 Planned | Performance, Images, Archive |

## Contributing

新しい機能のアイデアがある場合:

1. チケットを作成（テンプレート使用）
2. ロードマップに追加
3. 優先度と実装時期を議論
4. Phase に割り当て

## Notes

- 優先度は変更される可能性があります
- ユーザーフィードバックに基づいて調整します
- 技術的な制約により順序が変わることがあります
