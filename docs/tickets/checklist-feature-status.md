# チェックリスト機能（直接入力）の実装状況まとめ

## 概要
現在、カード一覧（TimelineBucketCard）において、カードのタイトル下にチェックリストを直接表示・編集できる機能が実装されています。
Notionのように、クリックすることで編集モードに入り、エンターキーで行追加、バックスペースで行削除などが可能なリッチなエディタとなっています。

今回、この機能を一時的に廃止するため、現在の実装状況と関連ファイルを整理しました。

## 関連ファイル一覧（実装面）

### UIコンポーネント（編集/表示）
- **`app/(board)/_components/checklist/ChecklistEditor.tsx`**
  - 編集用のメイン。行ごとの `<input>` + キーボード操作（Enter追加/Backspace削除/Tabインデントなど）で Notion ライクに編集。
  - 正規化 + auto-save + フォーカス管理を内包。
- **`app/(board)/_components/checklist/ChecklistPreview.tsx`**
  - 閲覧用。最大行数（デフォルト3）まで表示し、クリックで編集モードに移行。
- **`app/(board)/_components/timeline/TimelineBucketCard.tsx`**
  - A/B バケットカードで Preview/Editor をトグルし、`☑︎ {count}` バッジを時間表示付近に出す。
  - `onChecklistCommit` を通じてボード側へ保存要求を渡す。
- **`app/(board)/_components/timeline/TimelineEventItem.tsx`**
  - タイムライン上の時間帯イベント（Today/Tomorrow）でも同じエディタを埋め込み。リサイズハンドル付き。
  - `editingCardId` でドラッグ/リサイズ無効化しつつ編集。
- **`app/(board)/_components/timeline/MobileTimelineView.tsx`**
  - モバイル用のイベント/バケット一覧でも Preview/Editor とカウント表示を持つ。
- **`app/components/CardModal.tsx`**
  - カードモーダル内で直接編集し保存（タイトル・タグ・期限等と同時に送信）。`ChecklistEditor` をそのまま利用。
- **`app/c/[short_id]/[[...slug]]/page.tsx`**
  - 共有ページで checklist を正規化表示（閲覧のみ）。
- **`app/(board)/_components/KanbanBoardClient.tsx`**（旧UI）
  - 旧カンバンビューだが `normalizeChecklist`/`flattenChecklistText` で表示しているため残骸あり。

### ロジック・型・補助
- **`lib/checklist.ts`**
  - `Checklist` 型と `normalizeChecklist`/`clampChecklist`/`flattenChecklistText` などのユーティリティ。
- **`lib/api-types/timeline.ts`**
  - `TimelineBucketItem` / `TimelineEvent` に `checklist?: Checklist | null` を保持。
- **`app/(board)/_components/timeline/TimelineBoardPage.tsx`**
  - `handleChecklistCommit` で API `applyPatch` を叩き、ローカル状態・モーダルにも反映。
  - `flattenChecklistText` を検索ソースに含め、フィルター対象にしている。
- **`app/(board)/_components/timeline/DesktopTimelineView.tsx` / `MobileTimelineView.tsx`**
  - オーバーレイカードでも `checklistCount` を計算・表示。
- **`app/(board)/_components/timeline/TimelineColumn.tsx` / `TimelineGrid.tsx` / `TimelineBuckets.tsx`**
  - `onChecklistCommit`/`ChecklistSaveTrigger` を伝搬するための型・props 経路。

---

## データ構造

```typescript
// lib/checklist.ts

export type ChecklistLine = {
  id: string;      // 行ごとのユニークID
  level: number;   // インデントレベル (0-8)
  checked: boolean; // チェック状態
  text: string;    // テキスト内容
};

export type Checklist = {
  version: number; // バージョン管理用 (現在は 1)
  lines: ChecklistLine[];
};
```

## 実装の詳細（TimelineBucketCard内）

`TimelineBucketCard` コンポーネント内で以下のように実装されています。

1. **State**: `draftChecklist` としてローカルステートを持ち、親からの `item.checklist` と同期しています。
2. **切替ロジック**:
   ```tsx
   {isEditing ? (
       <ChecklistEditor
           value={draftChecklist}
           // ... props
       />
   ) : (
       <ChecklistPreview
           checklist={draftChecklist}
           // ... props
       />
   )}
   ```
3. **時間表示付近のバッジ**:
   期日表示の横に、チェックリストのアイテム数がある場合 `☑︎ {count}` のようなインジケータを表示しています。

## 無効化のおすすめ手順

### A. タイムライン編集だけ止める（モーダル編集は残す・最小リスク）
1. **タイムライン/バケット/UIでの表示・編集を止める**  
   - `TimelineBucketCard.tsx` / `TimelineEventItem.tsx` / `MobileTimelineView.tsx` の `ChecklistPreview`/`ChecklistEditor` ブロックと `☑︎ {count}` バッジを丸ごと外すか feature flag で `null` レンダリングにする。  
   - `onChecklistCommit`/`onChecklistEditingChange` は未使用になるため、呼び出し元で no-op を渡すか props を削る。
2. **カードモーダルから入力 UI を外す**  
   - **今回は残す**。`app/components/CardModal.tsx` の `ChecklistEditor` はそのまま維持し、モーダル経由でのみ直接編集を許可する。  
   - もし UI を隠したい場合はここを非表示にし、保存ハンドラへは `card.checklist` をそのまま返す。
3. **共有ページは表示のみ維持 or 非表示**  
   - `app/c/[short_id]/[[...slug]]/page.tsx` の checklist セクションを残すか、非表示にする場合はセクションごとコメントアウト。
4. **検索・フィルターのテキストソース**  
   - `TimelineBoardPage.tsx` の `flattenChecklistText` を検索文字列から除外（オプション）。外さない場合も UI 非表示なので動作には支障なし。

復元時は外した部分を戻すだけでよく、データ構造は保持される。

### B. エディタごと撤去（軽量化したい場合）
- 上記 A に加え `app/(board)/_components/checklist/` ディレクトリを削除し、関連 import を全削除。
- `lib/checklist.ts` は API 型互換のため残すことを推奨。完全撤去する場合は Supabase 型/`Timeline*` 型から `checklist` を外す必要があり影響大。

### C. 完全停止（API も外す場合）
- Supabase テーブル列は残したままでも害はないが、API パッチ (`applyPatch` で checklist 更新) を無効化したい場合は `TimelineBoardPage.tsx` の `handleChecklistCommit` で早期 return にするか、API ルートで無視するフラグを噛ませる。  
- 将来復活を見据えるならフラグ駆動で early-return するだけにしておくのが安全。

### 現状の「直接編集」について
- タイムライン上のカード（イベント/バケット）とカードモーダルの両方で直接編集が可能。Enter 追加・Backspace 削除・インデント変更・auto-save あり。
- UI を外せば編集経路は遮断でき、API 側は checklist を受け付け続けても動作は壊れない。
