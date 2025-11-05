# 2025-11-05 チケット

## 作成されたチケット

### 1. @メンション表示改善とテスト修正
**ファイル**: `mention-display-improvement.md`  
**優先度**: High  
**ステータス**: Open

#### 概要
- @メンションのサジェストUIをTrello風に改善（Display Name + Username の2行表示）
- 日本語（Display Name）と英語（Username）の両方で絞り込み可能にする
- 現在失敗している `comments.spec.ts:332` のテストを修正

#### 背景
- `username` システム追加により、TipTap Mention拡張の設定が不整合
- サジェストポップアップが表示されない
- `[data-mention-id]` 属性が付与されていない

#### 実装順序
1. 現在のコード調査（TipTap設定、保存形式）
2. UI改善（2行表示、検索ロジック）
3. 保存ロジック修正（data-mention-id付与）
4. テスト修正（セレクタ、アサーション）
5. 動作確認（ブラウザ + E2E）

---

**総チケット数**: 1
