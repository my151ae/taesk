# Username System (@+ID) Implementation

**作成日**: 2025-11-04
**優先度**: Medium
**ステータス**: TODO
**見積もり**: 2-3日

## 概要

現在のシステムではユーザーをメールアドレスで識別していますが、`@username`形式のIDシステムを導入し、よりフレンドリーなユーザー識別を実現する。

## 背景

- 現在：メールアドレス（例：`user@example.com`）で表示・検索
- 課題：メールアドレスは長く、プライバシー的にも露出が気になる
- 要望：`@yossy` のような短いIDで識別したい

## 目標

1. ユーザーがユニークな`username`を設定できる
2. Share Boardやコメントで`@username`形式で表示
3. @メンション時に`@username`で検索・タグ付け
4. メールアドレスは非公開にできる（オプション）

## 技術仕様

### 1. データベース変更

**Migration: `add_username_to_profiles.sql`**

```sql
-- Add username column
ALTER TABLE profiles
ADD COLUMN username TEXT UNIQUE;

-- Add username validation constraint
ALTER TABLE profiles
ADD CONSTRAINT username_format CHECK (
  username IS NULL OR (
    username ~ '^[a-zA-Z0-9_]{3,20}$'
  )
);

-- Create index for username search
CREATE INDEX idx_profiles_username ON profiles(username);

-- Add comment
COMMENT ON COLUMN profiles.username IS 'Unique username for @mentions and display (3-20 chars, alphanumeric + underscore)';
```

**制約:**
- 3-20文字
- 英数字 + アンダースコア (`a-zA-Z0-9_`)
- ユニーク
- NULL許可（既存ユーザーのため）

### 2. 型定義更新

**`lib/supabase.ts`**

```typescript
export interface ProfileSummary {
  id: string;
  username: string | null;  // 追加
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
}
```

### 3. API変更

#### a. GET/PATCH `/api/profiles`

**追加バリデーション:**
```typescript
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const RESERVED_USERNAMES = ['admin', 'system', 'support', 'help', 'api', 'www'];

// Username validation
if (username !== undefined) {
  if (!USERNAME_REGEX.test(username)) {
    return NextResponse.json({
      error: 'Username must be 3-20 characters (alphanumeric + underscore)'
    }, { status: 400 });
  }
  if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
    return NextResponse.json({
      error: 'This username is reserved'
    }, { status: 400 });
  }
}
```

**重複チェック:**
```typescript
// Check username availability
const { data: existing } = await supabase
  .from('profiles')
  .select('id')
  .eq('username', username)
  .neq('id', user.id)
  .maybeSingle();

if (existing) {
  return NextResponse.json({
    error: 'Username already taken'
  }, { status: 409 });
}
```

#### b. GET `/api/profiles/check-username?username=xxx`

**新規エンドポイント（リアルタイム重複チェック用）:**

```typescript
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const username = searchParams.get('username');

  if (!username || !USERNAME_REGEX.test(username)) {
    return NextResponse.json({ available: false, reason: 'invalid_format' });
  }

  if (RESERVED_USERNAMES.includes(username.toLowerCase())) {
    return NextResponse.json({ available: false, reason: 'reserved' });
  }

  const { data } = await supabase
    .from('profiles')
    .select('id')
    .eq('username', username)
    .maybeSingle();

  return NextResponse.json({ available: !data });
}
```

#### c. 他のAPI更新

- `/api/boards/[boardId]/members` - `username`を含める
- `/api/profiles/search` - `username`でも検索可能に
- `/api/cards/[cardId]/comments` - author の`username`を含める

### 4. UI変更

#### a. ProfileSettings.tsx

**Username入力フィールド追加:**

```tsx
<div>
  <label htmlFor="username" className="...">
    Username (optional)
  </label>
  <div className="relative">
    <span className="absolute left-3 top-2 text-gray-500">@</span>
    <input
      id="username"
      type="text"
      value={username}
      onChange={handleUsernameChange}
      placeholder="yourname"
      maxLength={20}
      className="pl-7 ..."
    />
  </div>
  {usernameError && <p className="text-red-500 text-xs">{usernameError}</p>}
  {usernameAvailable && <p className="text-green-500 text-xs">✓ Available</p>}
  <p className="text-xs text-gray-500">
    3-20 characters, letters/numbers/underscore only
  </p>
</div>
```

**リアルタイムチェック:**

```typescript
const [username, setUsername] = useState('');
const [usernameError, setUsernameError] = useState<string | null>(null);
const [usernameAvailable, setUsernameAvailable] = useState(false);

const checkUsernameDebounced = useMemo(
  () => debounce(async (value: string) => {
    if (!value || value.length < 3) return;

    const res = await fetch(`/api/profiles/check-username?username=${value}`);
    const data = await res.json();

    if (data.available) {
      setUsernameAvailable(true);
      setUsernameError(null);
    } else {
      setUsernameAvailable(false);
      setUsernameError(
        data.reason === 'reserved'
          ? 'This username is reserved'
          : 'Username already taken'
      );
    }
  }, 500),
  []
);
```

#### b. ShareDialog.tsx

**表示優先順位を変更:**

```tsx
// Before: display_name || full_name || email
// After:  @username || display_name || full_name || email

const displayName = member.profile?.username
  ? `@${member.profile.username}`
  : member.profile?.display_name
  || member.profile?.full_name
  || 'Unknown';
```

#### c. CommentsPanel.tsx / Mention.tsx

**@メンション表示:**

```tsx
// コメント作者名
const authorName = comment.author?.username
  ? `@${comment.author.username}`
  : comment.author?.display_name
  || comment.author?.full_name
  || comment.author?.email
  || 'Unknown';

// @メンション表示
<Mention
  id={mention.id}
  label={mention.username ? `@${mention.username}` : mention.display_name || mention.email}
/>
```

#### d. MentionSuggestion.tsx

**@メンション検索時にusernameでマッチ:**

```typescript
// Search by username, display_name, full_name, email
const matches = profiles.filter(p =>
  p.username?.toLowerCase().includes(query) ||
  p.display_name?.toLowerCase().includes(query) ||
  p.full_name?.toLowerCase().includes(query) ||
  p.email?.toLowerCase().includes(query)
);

// Display with @username if available
const renderSuggestion = (profile: ProfileSummary) => (
  <div>
    <div className="font-medium">
      {profile.username ? `@${profile.username}` : profile.display_name || profile.full_name}
    </div>
    {profile.username && (
      <div className="text-xs text-gray-500">{profile.display_name || profile.email}</div>
    )}
  </div>
);
```

### 5. E2E テスト

**`e2e/profile-username.spec.ts`** (新規)

```typescript
test.describe('Username System', () => {
  test('should set username', async ({ page }) => {
    await page.goto('/');
    // Open profile settings
    // Enter username
    // Check availability
    // Save
    // Verify @username is displayed
  });

  test('should reject duplicate username', async ({ page }) => {
    // Try to set already-taken username
    // Verify error message
  });

  test('should reject invalid username format', async ({ page }) => {
    // Try "a" (too short)
    // Try "this-has-dashes" (invalid chars)
    // Try "thisusernameiswaytoolongtobevalid" (too long)
  });

  test('should display @username in share dialog', async ({ page }) => {
    // Set username
    // Share board with another user
    // Verify @username is shown in members list
  });

  test('should display @username in comments', async ({ page }) => {
    // Set username
    // Post comment
    // Verify @username is shown as author
  });

  test('should search by @username in mentions', async ({ page }) => {
    // Set username
    // Type @ in comment
    // Type username
    // Verify user appears in suggestions
  });
});
```

## 実装順序

### Phase 1: データベース・型定義 (30分)
1. マイグレーション作成・実行
2. `ProfileSummary`に`username`追加
3. 動作確認（既存機能が壊れていないこと）

### Phase 2: API実装 (1-2時間)
1. `/api/profiles` に username 保存・バリデーション追加
2. `/api/profiles/check-username` 新規作成
3. 他のAPI（members, search, comments）で username 取得

### Phase 3: UI実装 - ProfileSettings (1-2時間)
1. Username入力フィールド追加
2. リアルタイム重複チェック実装
3. 保存・エラーハンドリング

### Phase 4: UI実装 - 表示部分 (2-3時間)
1. ShareDialog で @username 表示
2. CommentsPanel で @username 表示
3. Mention コンポーネント調整
4. MentionSuggestion で username 検索対応

### Phase 5: テスト (2-3時間)
1. E2Eテスト作成
2. 手動テスト
3. エッジケース確認

### Phase 6: ドキュメント (30分)
1. `/docs/detail/username-system.md` 作成
2. CHANGELOG更新

## 考慮事項

### セキュリティ
- [x] Username重複チェック（Race condition対策: DB UNIQUE制約）
- [x] 予約語チェック
- [x] フォーマットバリデーション（SQLインジェクション対策）
- [ ] レート制限（username変更の頻度制限）

### UX
- [ ] Username変更履歴（頻繁な変更を防ぐため、変更は月1回まで？）
- [ ] Username変更時の通知（メンションしたユーザーへ）
- [ ] デフォルトusernameの自動生成（例：`user_12345`）

### 互換性
- [x] 既存ユーザーは`username`がNULL（徐々に設定してもらう）
- [x] NULLの場合は従来通り display_name/email で表示
- [ ] Migration後のアナウンス（「Usernameを設定しましょう」）

## 成果物

- [ ] Migration SQL
- [ ] API実装（3エンドポイント修正 + 1新規）
- [ ] UI実装（ProfileSettings, ShareDialog, Comments, Mentions）
- [ ] E2Eテスト
- [ ] ドキュメント

## 参考

- GitHub: `@username`
- Twitter/X: `@handle`
- Discord: `username#0000` (旧) → `@username` (新)

---

**次のステップ**: Phase 1のマイグレーション作成から開始
