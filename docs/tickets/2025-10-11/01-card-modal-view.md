# Ticket 01: カードクリック時のモーダル表示

**Date**: 2025-10-11
**Priority**: 🔵 Medium
**Status**: 🟢 完了
**Phase**: 2.6 (UI/UX改善)

## 概要

カードをクリックした際に、インライン編集ではなくモーダルで詳細表示・編集画面を表示する。
現在の「Edit」「Delete」ボタンをモーダル内に統合し、よりTrelloライクなUIにする。

## 背景

現在の仕様：
- カード上に「Edit」「Delete」ボタンが直接配置
- Editクリックでインライン編集に切り替わる
- UIが煩雑で、モバイルでは操作しづらい

改善後の仕様：
- **カード全体がクリック可能**
- クリックでモーダルが開く
- モーダル内にタイトル、説明、タグ、期限、優先度、担当者などすべての編集UIを配置
- 「Save」「Delete」「Close」ボタンをモーダル内に配置
- URLパラメータ `?board=xxx&card=yyy` でモーダルを直接開ける（既存機能を活用）

## 実装方針

### 1. UI構造の変更

#### Before（現在）
```tsx
<div className="card">
  {isEditing ? (
    <div>編集UI（インライン）</div>
  ) : (
    <div>
      <h3>{card.title}</h3>
      <p>{card.description}</p>
      <button>Edit</button>
      <button>Delete</button>
    </div>
  )}
</div>
```

#### After（モーダル）
```tsx
{/* カード（クリック可能） */}
<div onClick={() => openCardModal(card.id)} className="card cursor-pointer">
  <h3>{card.title}</h3>
  <p>{card.description}</p>
  {/* バッジ表示: タグ、期限、優先度など */}
</div>

{/* モーダル（条件付きレンダリング） */}
{selectedCardId === card.id && (
  <div className="modal-overlay" onClick={closeModal}>
    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
      {/* モーダル内に編集UI全体 */}
      <input value={title} onChange={...} />
      <textarea value={description} onChange={...} />
      {/* タグ、期限、優先度、担当者、ボード移動、リンクコピー */}

      <div className="modal-actions">
        <button onClick={handleSave}>Save</button>
        <button onClick={handleDelete}>Delete</button>
        <button onClick={closeModal}>Close</button>
      </div>
    </div>
  </div>
)}
```

### 2. State管理

```typescript
const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

// URLパラメータからカードIDを取得（既存のuseSearchParams活用）
useEffect(() => {
  const cardParam = searchParams.get('card');
  setSelectedCardId(cardParam);
}, [searchParams]);

// カードを開く
const openCardModal = (cardId: string) => {
  setSelectedCardId(cardId);
  updateURL(currentBoardId, cardId); // URLに反映
};

// カードを閉じる
const closeCardModal = () => {
  setSelectedCardId(null);
  updateURL(currentBoardId, null); // URLからcard=xxx削除
};
```

### 3. モーダルコンポーネント設計

```tsx
function CardModal({
  card,
  boards,
  onSave,
  onDelete,
  onClose,
}: {
  card: Card;
  boards: Board[];
  onSave: (id: string, updates: Partial<Card>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description);
  const [tags, setTags] = useState(card.tags || []);
  const [dueDate, setDueDate] = useState(card.due_date || '');
  const [priority, setPriority] = useState(card.priority || 'medium');
  const [assignedTo, setAssignedTo] = useState(card.assigned_to || '');
  const [targetBoardId, setTargetBoardId] = useState(card.board_id);

  const handleSave = () => {
    onSave(card.id, {
      title,
      description,
      tags,
      due_date: dueDate || null,
      priority,
      assigned_to: assignedTo || null,
    });

    // ボード移動
    if (targetBoardId !== card.board_id) {
      // onMoveToBoard(card.id, targetBoardId);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* モーダルヘッダー */}
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-2xl font-bold">Edit Card</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">✕</button>
        </div>

        {/* モーダルボディ */}
        <div className="space-y-4">
          {/* タイトル */}
          <div>
            <label className="text-sm font-medium mb-1 block">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>

          {/* 説明 */}
          <div>
            <label className="text-sm font-medium mb-1 block">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg resize-none"
              rows={4}
            />
          </div>

          {/* タグ、期限、優先度、担当者、ボード移動、リンクコピーなど */}
          {/* ... 既存のSortableCard内の編集UIを移植 ... */}
        </div>

        {/* モーダルフッター */}
        <div className="flex gap-2 mt-6">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600"
          >
            Save
          </button>
          <button
            onClick={() => {
              if (confirm('Delete this card?')) {
                onDelete(card.id);
                onClose();
              }
            }}
            className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
          >
            Delete
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

### 4. SortableCardの変更

```tsx
function SortableCard({ card, onClick }: { card: Card; onClick: (id: string) => void }) {
  return (
    <div
      onClick={() => onClick(card.id)}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 mb-3 cursor-pointer border border-slate-200/60 dark:border-gray-700/50"
    >
      {/* タイトル */}
      <h3 className="font-semibold text-sm text-slate-700 dark:text-gray-100 mb-2">
        {card.title}
      </h3>

      {/* 説明（短縮表示） */}
      {card.description && (
        <p className="text-xs text-slate-600 dark:text-gray-400 line-clamp-2 mb-2">
          {card.description}
        </p>
      )}

      {/* バッジ表示: タグ、期限、優先度 */}
      <div className="flex flex-wrap gap-1">
        {card.tags?.map((tag) => (
          <span key={tag} className="px-2 py-0.5 bg-sky-100 dark:bg-sky-900 text-sky-700 dark:text-sky-300 rounded text-xs">
            {tag}
          </span>
        ))}
        {card.due_date && (
          <span className="px-2 py-0.5 bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300 rounded text-xs">
            📅 {new Date(card.due_date).toLocaleDateString()}
          </span>
        )}
        {card.priority !== 'medium' && (
          <span className="text-xs">
            {card.priority === 'high' ? '🔴' : '🟢'}
          </span>
        )}
      </div>
    </div>
  );
}
```

### 5. キーボードショートカット（オプション）

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Escキーでモーダルを閉じる
    if (e.key === 'Escape' && selectedCardId) {
      closeCardModal();
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [selectedCardId]);
```

## 実装タスク

- [x] CardModalコンポーネントを作成（app/components/CardModal.tsx）
- [x] SortableCardをクリック可能な表示専用カードに変更
- [x] バッジ表示（タグ、期限、優先度）をSortableCardに追加
- [x] selectedCardIdのstate管理とURLパラメータ連携（既存機能を活用）
- [x] openCardModal/closeCardModal関数実装
- [x] モーダル内に既存の編集UIを移植
- [x] Save/Delete/Closeボタンの実装
- [x] モーダル外クリックで閉じる処理
- [x] Escキーで閉じるキーボードショートカット
- [x] ドラッグ&ドロップとクリックの競合解決（isDraggingチェック）
- [x] モバイルでのモーダル表示最適化（max-h-[90vh], overflow-y-auto）
- [x] E2Eテスト更新（カードクリック → モーダル表示 → 編集 → 保存）
- [x] 既存のEdit/Deleteボタン削除（SortableCardから削除）
- [ ] コミット

## 技術的注意点

### ドラッグ&ドロップとクリックの競合

@dnd-kitのドラッグとクリックが競合する可能性があるため、以下で対応：

```tsx
const { listeners } = useSortable({ id: card.id });

return (
  <div>
    {/* ドラッグハンドル（アイコンなど） */}
    <div {...listeners} className="drag-handle cursor-grab">
      ⋮⋮
    </div>

    {/* クリック可能エリア */}
    <div onClick={() => onClick(card.id)} className="cursor-pointer">
      {/* カード内容 */}
    </div>
  </div>
);
```

または、ドラッグ開始時にクリックイベントを無効化：

```tsx
const [isDragging, setIsDragging] = useState(false);

const handleDragStart = () => setIsDragging(true);
const handleDragEnd = () => {
  setIsDragging(false);
};

const handleClick = () => {
  if (!isDragging) {
    onClick(card.id);
  }
};
```

### モーダルのアクセシビリティ

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
>
  <h2 id="modal-title">Edit Card</h2>
  {/* ... */}
</div>
```

### モバイル対応

- モーダルは画面の90%幅、90%高さに制限
- スクロール可能にする（`overflow-y-auto`）
- タッチ操作でモーダル外をタップして閉じる

## 完了条件

- [x] カードをクリックするとモーダルが開く
- [x] モーダル内で全フィールドを編集可能
- [x] Save/Delete/Closeボタンが動作
- [x] URLパラメータ `?card=xxx` でモーダルが直接開く（既存機能）
- [x] モーダル外クリック/Escキーでモーダルが閉じる
- [x] ドラッグ&ドロップとクリックが競合しない（isDraggingチェック）
- [x] モバイルでも快適に操作できる（レスポンシブデザイン）
- [x] E2Eテストが更新され動作確認済み

## 実装結果

### 変更ファイル

1. **app/components/CardModal.tsx** - 新規作成
   - 全編集機能を含むモーダルコンポーネント
   - タイトル、説明、タグ、期限、優先度、担当者、ボード移動、リンクコピー機能
   - Escキーで閉じる、モーダル外クリックで閉じる

2. **app/page.tsx** - 大幅に簡略化
   - SortableCard: ~280行 → ~75行（Edit/Delete機能削除）
   - openCardModal/closeCardModal関数追加
   - CardModal条件付きレンダリング追加
   - SortableList propsからonEditCard, onDeleteCard, boards, onMoveToBoard削除

3. **e2e/kanban.spec.ts** - E2Eテスト更新
   - 'should edit a card': Edit buttonクリック → カードクリックに変更
   - 'should delete a card': Delete buttonクリック → カードクリック → モーダル内Deleteに変更

### 技術的実装

- **ドラッグ vs クリック**: isDraggingフラグで競合回避
- **URL同期**: 既存のselectedCardId, updateURL機能を活用
- **モーダルアクセシビリティ**: role="dialog", aria-modal, aria-labelledby
- **モバイル対応**: max-w-2xl, max-h-[90vh], overflow-y-auto, p-4

### コード削減

- SortableCardから約200行の編集ロジック削除
- インライン編集UIの複雑さを排除
- コンポーネント責務の明確化（表示専用カード vs 編集モーダル）

## 参考

- Trello Card Modal: https://trello.com
- @dnd-kit Click vs Drag: https://docs.dndkit.com
