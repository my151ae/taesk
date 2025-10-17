# 02 — カード担当者（Assignees）仕上げ ➜ Phase 2 / 3.1 実装計画

**作成日**: 2025-10-16  
**作成者**: 松本Ops  
**対象リリース**: Phase 2（～3.1 まで）

---

## 0. 目的 / スコープ
- 本番 Supabase で **担当者の永続化が確実に行われる**状態へ仕上げる。
- **profiles 自動プロビジョニング**と**最小限の RLS**を整備し、複数アカウント/共有環境でも安定動作。
- アプリ側の **フォールバック（`assigned_to` 互換・`assigneeIdSupported` 分岐）を撤去**し、`assignee_id` を正本化。
- **Phase 3 の「同一ボードメンバー限定選択」**には踏み込まない（本書は **Phase 2 / 3.1** まで）。

---

## 1. 現状整理（事実）
- `public.profiles` と `cards.assignee_id (uuid → profiles.id)` は本番に適用済み。
- 一部の環境で **別アカウントが初回ログイン時に profiles 行がなく、アサイン時に FK/RLS が干渉**しエラーが発生。
- E2E はフォールバック込みでグリーン（`expected: 35 / unexpected: 0 / flaky: 0`）。
- 共有環境での RLS 方針（誰が profiles を作れるか/見れるか）の最終合意が未了。

---

## 2. 課題と方針
### 2.1 課題
1) **profiles 不存在問題**: 新規ユーザーの profiles 行が未作成のまま `assignee_id` 参照でエラー。  
2) **RLS の暫定ゆるめ設定**: anon/auth で広く操作可にしている箇所があり、共有環境では過剰権限。  
3) **フォールバック残存**: `assigned_to` と二重管理で複雑・バグ源。  

### 2.2 方針（Phase 2 / 3.1 の範囲）
- **自動プロビジョニング**: `auth.users` への INSERT をトリガに `public.profiles` を自動作成 + 既存ユーザーはバックフィル。  
- **最小RLS**: profiles は **自分の行のみ insert/update 可 / 全認証ユーザーは select 可**。カードの RLS は現行踏襲。  
- **互換撤去**: `assignee_id` を正本、`assigned_to` は読み取りのみ（最終的に削除予定）。

---

## 3. DB 設計とポリシー
### 3.1 スキーマ（既存）
- `public.profiles (id uuid pk, display_name text, avatar_url text, created_at timestamptz)`
- `public.cards.assignee_id uuid null references public.profiles(id)`

### 3.2 RLS（Phase 2 / 3.1 最小構成）
```sql
-- RLS 有効化
alter table public.profiles enable row level security;

-- 認証ユーザーは profiles を閲覧可（候補表示のため）
create policy if not exists "profiles_select_all_auth"
  on public.profiles for select
  to authenticated
  using (true);

-- 自分のプロフィールだけ insert 可能
create policy if not exists "profiles_insert_self"
  on public.profiles for insert
  to authenticated
  with check (id = auth.uid());

-- 自分のプロフィールだけ update 可能
create policy if not exists "profiles_update_self"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
```
> 備考: `service_role` には従来と同等の権限付与を維持。

### 3.3 自動プロビジョニング（トリガ）
```sql
create or replace function public.handle_new_user_profile()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'user_'||substr(new.id::text,1,8)),
    null
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

-- 既存があれば差し替え
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user_profile();
```

### 3.4 バックフィル（既存ユーザー）
```sql
insert into public.profiles (id, display_name, avatar_url)
select u.id,
       coalesce(u.raw_user_meta_data->>'name', 'user_'||substr(u.id::text,1,8)),
       null
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;
```

---

## 4. アプリ実装（仕上げ）
### 4.1 互換撤去
- `assigneeIdSupported` 分岐を削除。
- フォールバックアップサート（`assigned_to` 併用）を削除。
- `CardModal.onSave` は `assignee_id` のみ送信（`assigned_to` は送らない）。

### 4.2 UI/UX
- 担当者セレクタは `profiles` 起点（`display_name` / `avatar_url`）。
- 「Unassigned」選択を維持（`assignee_id = NULL`）。
- 将来の Phase 3 に向けたメモ: 候補は **board_members** に絞る（本書の範囲外）。

### 4.3 Realtime/オフライン
- 追加列は既存購読/キューで伝播（変更不要）。
- 非同期待ちは `expect.poll` を継続（DB 事実で待つ）。

---

## 5. テスト計画（E2E / スモーク）
### 5.1 新規・別アカウントシナリオ
1. 新規ユーザーでログイン → **profiles が自動作成**されることを SQL で確認。  
2. 既存ボードのカードを開き、担当者を自分/他ユーザーに切替 → 保存。  
3. `select assignee_id from public.cards where id = :card_id;` が期待値。  
4. 別端末/別ブラウザで Realtime 反映確認。  

### 5.2 コマンド
```bash
npx playwright test --reporter=json > playwright-report.json
sed -n '/^{/,$p' playwright-report.json | jq '.stats' # expected / unexpected / flaky
```

---

## 6. デプロイ&リリース手順
1) **DB**: トリガ・RLS・バックフィルを Staging → 本番の順で適用。  
2) **App**: フォールバック撤去をデプロイ。  
3) **確認**: 新規ユーザーでログイン→自動作成→アサイン→再読込・別端末確認。  
4) **E2E**: 共有環境で `unexpected: 0 / flaky: 0` を確認。  

### ロールバック
- App: 直前バージョンへ即時ロールバック。  
- DB: トリガ無効化（`drop trigger on_auth_user_created`）、RLS は従来方針へ戻す。  
- 影響範囲: `profiles` 新規行は残存しても実害なし。

---

## 7. ドキュメント更新（このチケットで）
- `docs/roadmap.md` : Phase 2 / 3.1 を **Completed** に更新。  
- `docs/tickets/2025-10-16/` : 本書（02）を追加、01 に「フォールバック撤去済み」注記を追記。  

---

## 8. 将来課題（Phase 3 以降のメモ）
- **board_members** 実装（ボード×ユーザーの参加関係）
- セレクタ候補を **同一ボードメンバーのみに絞る** RLS/アプリ連携
- 監査ログ（アサイン変更履歴）

---

## 9. 完了の受け入れ基準（Phase 2 / 3.1）
- [ ] 新規ユーザー初回ログイン時に `profiles` が自動作成される  
- [ ] `cards.assignee_id` による担当者の保存/再読込/Realtime 反映が安定  
- [ ] 別アカウントでもアサイン操作がエラーにならない（FK/RLS OK）  
- [ ] フォールバック/互換コードを撤去し、E2E **unexpected: 0 / flaky: 0**  
- [ ] ドキュメント更新（本書/roadmap）完了  

---

### 付録: 権限の再点検チェックリスト
- [ ] `profiles` RLS: select=all(auth), insert/update=self のみ  
- [ ] `profiles` trigger: 稼働中（auth.users insert で作動）  
- [ ] 既存ユーザーのバックフィル済み  
- [ ] `cards` RLS: 従来通り更新可（新列で不許可になっていない）  
- [ ] `service_role` の権限は従来通り  

