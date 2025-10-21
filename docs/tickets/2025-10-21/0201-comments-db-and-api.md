# 0201 - Comments DB and API Updates

**Status**: ✅ **完了**
**Date**: 2025-10-21

## 概要
コメント機能のDB schema更新とAPI Routes更新を実施。メンション検索の高速化、Idempotency-Key対応、エラーフォーマット統一を完了。

---

## 実施内容

### 1. DB Schema 更新

#### 1.1 GIN Index 追加
```sql
-- Migration: add_comments_mentions_gin_index
create index if not exists idx_comments_mentions_gin
on comments using gin(mentions);
```
- **目的**: `mentions uuid[]` 配列の高速検索
- **効果**: `@mention` クエリのパフォーマンス向上

#### 1.2 Idempotency Key カラム追加
```sql
-- Migration: add_comments_idempotency_key
alter table comments add column if not exists idempotency_key text;

create unique index if not exists idx_comments_idempotency_key
on comments(idempotency_key)
where idempotency_key is not null and deleted_at is null;
```
- **目的**: オフライン再送時の重複防止
- **制約**: UNIQUE constraint により同一キーの重複登録を防止

---

### 2. API Routes 更新

#### 2.1 エラーフォーマット統一
すべてのコメントAPIで新形式エラーフォーマットに統一：

**新形式**:
```typescript
{ error: { code: string, message: string }, issues?: ValidationIssue[] }
```

**エラーコード**:
- `UNAUTHENTICATED` - 未認証
- `VALIDATION_ERROR` - バリデーション失敗
- `DB_ERROR` - データベースエラー
- `INTERNAL_ERROR` - 内部エラー

**対象ファイル**:
- `app/api/cards/[cardId]/comments/route.ts` (GET, POST)
- `app/api/comments/[commentId]/route.ts` (PATCH, DELETE)

#### 2.2 Idempotency-Key ヘッダー対応
**POST /api/cards/[cardId]/comments** に実装：

```typescript
const idempotencyKey = request.headers.get('Idempotency-Key');
if (idempotencyKey) {
  // 既存コメントをチェック
  const { data: existingComment } = await supabase
    .from('comments')
    .select('*')
    .eq('idempotency_key', idempotencyKey)
    .is('deleted_at', null)
    .maybeSingle();

  if (existingComment) {
    // 既存を返す（冪等性）
    return NextResponse.json({ comment: existingComment }, { status: 200 });
  }
}

// 新規作成時にキーを保存
await supabase.from('comments').insert({
  // ...
  idempotency_key: idempotencyKey || null,
});
```

**動作**:
- ヘッダーに `Idempotency-Key: <uuid>` がある場合、重複チェック
- 既存があれば HTTP 200 で既存コメントを返す
- 新規の場合は HTTP 201 で作成して返す

---

### 3. 型定義更新

**lib/supabase.ts**:
```typescript
export interface Comment {
  id: string;
  card_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  mentions: string[];
  idempotency_key?: string | null; // 追加
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
```

---

## 受け入れ基準（AC）

- [x] GIN index が `comments.mentions` に作成済み
- [x] `idempotency_key` カラムと UNIQUE index が作成済み
- [x] すべてのコメントAPIが新エラーフォーマットを使用
- [x] POST API が Idempotency-Key ヘッダーに対応
- [x] TypeScript ビルドが成功（エラー 0 件）
- [ ] E2E テストでコメント CRUD が通る（0209 で実施予定）
- [ ] Idempotency-Key の E2E テストが通る（0209 で実施予定）

---

## 変更ファイル

### Database
- Migration: `add_comments_mentions_gin_index.sql`
- Migration: `add_comments_idempotency_key.sql`

### API Routes
- `app/api/cards/[cardId]/comments/route.ts`
  - GET: エラーフォーマット統一
  - POST: エラーフォーマット統一 + Idempotency-Key 対応
- `app/api/comments/[commentId]/route.ts`
  - PATCH: エラーフォーマット統一
  - DELETE: エラーフォーマット統一

### Types
- `lib/supabase.ts`
  - `Comment` interface に `idempotency_key` 追加

---

## テスト結果

### ビルド
```bash
npm run build
✓ Compiled successfully
✓ Linting and checking validity of types
✓ Generating static pages (10/10)
```

### 型エラー
- **0 件** - すべての型定義が正しく更新済み

---

## 次のステップ

0202 に進む：
- CardModal へのコメント UI 統合
- Realtime 購読の実装
- 楽観的更新の実装

---

## 参考

- エラーフォーマット: `/docs/tickets/2025-10-20/01-unify-error-format-tests.md`
- Epic ticket: `/docs/tickets/2025-10-20/02_コメント機能＆通知システム_実装の流れ（phase_3_2_3.md`
