
# 01 — Dateレーン化 & タイムライン土台（既存D&D/1行カードを前提）

## 背景 / 現状
- 既に **レーン/カードのCRUD**、**D&D（同一レーン/別レーン）**、**1行インライン編集** は稼働中。E2E でも `+ Add List` / `+ Add Card`、リネーム、削除、D&D が検証されている（例: `e2e/kanban.spec.ts`）。
- 現在のレーンは **ステータス系（例：To Do / In Progress / Done）**。
- ここから **日付ドリブン（今日/明日/今週/来週/今月…）の“Dateレーン”** と **縦タイムライン（1時間グリッド）** を導入し、カード高さを実時間（分）に比例させる。  
- **親子は分離表示**：子のみ表示時は、**親の“ゴースト”ラベル**（点線/波線）で出自を示し、クリックで親へジャンプできる。

> 本チケットは「新しい表示モード（Dateレーン＋タイムライン）」の土台作成。既存のステータス系カンバンは **維持** し、切り替えで併存させる。

---

## スコープ（本チケットで実装）
1. **ビューの二系統化（切替）**
   - **Kanban（既存）** と **Schedule（新規）** を切替可能にする（UIトグル or /board?view=schedule など）。
   - 既存のルーティング/状態を流用し、**表示層の構成**のみ追加。

2. **Dateレーンの導入**
   - レーン種別：`inbox / today / tomorrow / this_week / next_week / this_month`。
   - レーン移動で `listId` を更新、`date` は `mapListToDate(listId, base)` で自動更新（`weekStartsOn: 1`）。
   - 既存ステータスレーンとは **別のビュー状態**として扱う（既存リストの破壊的変更はしない）。

3. **タイムライン土台（1時間グリッド）**
   - 左帯：**00:00–24:00、1時間刻み**のメジャー／**15分**のサブグリッド。
   - 右帯：**フローティング領域**（`hasTime=false`）。
   - `hasTime=true` のカードは左帯に接着。帯を跨ぐD&Dで `hasTime` を自動トグル。
   - **カード高さ**：`height = ((end - start)/60min) * HOUR_PX`（`HOUR_PX` は仮64px）。最小高20px。

4. **親ゴースト（分離表示の出自ラベル）**
   - 子カードに **親ゴーストバッジ**（点線/波線）。`[Parent: 親タイトル • レーン]`。
   - クリックで **親位置へスクロール／ジャンプ**（親が非表示ならトースト＋リンク）。

5. **キーボード最低限**
   - `Enter`（下行作成）/ `Backspace`（空行削除）/ `↑↓`（上下移動）を新ビューでも維持。
   - `←→` は将来拡張（別チケット）。

6. **E2E（Scheduleビューの基本）**
   - DateレーンでのD&D、`hasTime`トグル、カード高さの最小値・スナップ（15分）検証。

---

## 非スコープ（別チケット）
- 階層編集の完成度（Tab/Shift+Tab）、親ドラッグで子サブツリー移動の詳細ルール
- BlockNote/tiptap のリッチ編集
- DB永続化/移行（必要なら 05 で対応）
- モバイル最適化

---

## 受け入れ基準（Acceptance Criteria）
- **ビュー切替**で Kanban（既存） / Schedule（新規）が選べる。
- Schedule ビューのレーンが `inbox/today/tomorrow/this_week/next_week/this_month` で表示される。
- レーン間D&Dで `listId` が更新され、`date` が `mapListToDate` に基づき自動更新される（`inbox` は `null`）。
- タイムライン帯は **1時間グリッド**、`hasTime=true` のカードは帯に接着し、高さが **実分に比例**して描画される（最小高あり）。
- 帯を跨ぐドロップで `hasTime` がトグルされる。
- 子カードに **親ゴースト** バッジが表示され、クリックで **親位置へジャンプ** できる。

---

## 実装タスク（詳細）

### ディレクトリ（追加）
```
app/(routes)/board/
  schedule/
    page.tsx                      # Schedule ビュー（Dateレーン＋タイムライン）
    _components/
      ScheduleLane.tsx
      Timeline.tsx
      FloatingColumn.tsx
      GhostParentBadge.tsx
    _lib/
      date.ts                     # mapListToDate (週: 月曜始まり)
    _hooks/
      useScheduleState.ts         # 既存 Zustand をラップ（必要なら）
```

### 1) Dateレーン & 日付
- `date.ts`: `mapListToDate(listId, base=Date)` 実装（today/tomorrow/this_week/next_week/this_month/inbox）。

### 2) タイムライン
- `Timeline.tsx`: 1時間グリッド（副目盛り15分）、`HOUR_PX` による高さ計算、スクロール同期。
- `FloatingColumn.tsx`: `hasTime=false` のカード表示。

### 3) D&D
- タイムライン帯/フローティング帯それぞれにドロップ可能、跨ぎで `hasTime` トグル。
- 既存 D&D レイヤのセンサー設定を流用（@dnd-kit）。

### 4) 親ゴースト
- `GhostParentBadge.tsx`: 点線/波線スタイル、クリックで `document.getElementById(parentId)` へスクロール（暫定）。

### 5) E2E（追加）
- `e2e/schedule.spec.ts`：DateレーンでのD&D、`hasTime`トグル、1時間グリッド上での高さ確認（しきい値チェック）。

---

## テスト観点
- `mapListToDate`：週末日（月曜始まり）、月末、日跨ぎ。
- `hasTime` トグルの正確性（帯跨ぎ/同帯内での保持）。
- 高さの最低値、重なり時の見え方、スクロール同期。

---

## ロールアウト
- まずは内部用トグル（`?view=schedule`）。
- UI が固まったら切替ボタンを常設。

---

## 補足
- 既存の Kanban 機能は **そのまま維持**（リグレッションを避ける）。
- 親子D&Dの詳細は **02** に分離。

