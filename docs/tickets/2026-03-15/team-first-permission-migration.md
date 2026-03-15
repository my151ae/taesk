# Team-first 権限モデルへの全面移行

## Summary
現行の taesk は概念上は `Team > Board` だが、実装上は Board 招待や Board member 追加から Team membership が派生しうる混成状態になっている。現行実装では Board 単位認可の正本は `board_members` のままだが、Board 招待受諾や `board_members` 追加を契機に Team membership が自動補完されうるため、概念と実装が一致していない。これを解消し、**Board access は Team membership を前提にしか作れない** ルールへ統一する。

最終原則:
- Team は人の所属を管理する
- Board は Team メンバーに対してのみ access を付与する
- `board_members` は Board 認可の正本として維持する
- ただし `board_members ⊆ team_members` を DB / API / RLS / UI すべてで保証する
- Team から外れたユーザーは、その Team 配下の全 Board access を失う
- 既存データ補完後、`boards.team_id` は最終的に `NOT NULL` 制約へ引き上げる

## Implementation Changes

### 1. DB / Migration
- `board_members` 追加時に同一 Team の `team_members` 存在を検証する validation trigger / function を追加し、未所属なら `TEAM_MEMBERSHIP_REQUIRED` で reject する。
- 既存の `ensure_team_membership_for_board_member()` / `trg_sync_team_member_from_board_member` は削除し、Board member 追加で Team `guest` を自動補完する挙動を完全に止める。
- `accept_board_invite()` と関連 trigger / function からも Team `guest` 自動追加ロジックを削除する。
- 既存 Board の `team_id` を補完する dry-run / apply SQL を用意し、補完完了後に `boards.team_id` を `NOT NULL` へ引き上げる。移行期間中のみ nullable を許容する。
- `team_members` 削除時に同 Team 配下の `board_members` を削除する cleanup trigger を追加する。cleanup の正本は DB とし、API は transaction と activity log を追加で担保する。
- ただし Team member 削除前に、そのユーザーが Team 配下のいずれかの Board で最後の `owner` になっていないかを検査する。最後の owner なら cleanup を拒否し、owner 移譲または明示的な再割当フローを必須にする。
- 移行前確認用 SQL を追加する。対象は orphan `board_members`、`team_id IS NULL` の Board、移行対象の `board_invites`、Team / Board role の整合確認。
- backfill 用 apply SQL は冪等に作成し、同じ user / board / invite に対して再実行しても重複作成しないことを保証する。
- DB テストでは API 経由だけでなく、`board_members` への直接 insert / upsert が Team 未所属ユーザーで拒否されることを必須で検証する。

### 2. API / Server
- `/api/boards/[boardId]/members` と `board_members` を生成する全 route / RPC を Team membership 必須に変更する。自動 `guest` 補完は禁止する。
- Team 未所属ユーザーに Board access を付与しようとした場合は、共通エラー `TEAM_MEMBERSHIP_REQUIRED` を返す。
- Team member 削除 API は Team membership 削除前に「最後の Board owner」衝突を検査し、該当時は owner 移譲を要求して失敗させる。
- 衝突がなければ、Team membership 削除、配下 Board access cleanup、activity log 記録を transaction 相当で保証する。
- Board 作成 API の Team role 判定 (`owner/admin`、`member + allow_member_create_board`) は維持し、`guest` は作成不可のままにする。
- 既存 Board 招待 API をラッパー化する場合、外部契約は維持しても内部的には Team invite 作成と pending board access 作成へ分解する。
- エラー契約は少なくとも `TEAM_MEMBERSHIP_REQUIRED` と `LAST_BOARD_OWNER_TRANSFER_REQUIRED` を持ち、UI は両方を個別ハンドリングできるようにする。

### 3. 招待モデル
- 正規招待は Team invite に一本化する。
- `board_invites` は新規発行停止とし、UI 上の Board 招待導線が必要なら内部的に「Team invite + pending board access」へ変換する。
- pending access 用の保持方法を追加する。最低限 `team_id`, `board_id`, `email`, `normalized_email`, `board_role`, `status`, `accepted_at`, `invited_by` を持たせる。
- pending board access は `(team_id, board_id, normalized_email)` を一意制約とし、受諾時は idempotent に `board_members` を upsert する。
- Team invite を受諾した時点で、そのメールアドレスに紐づく pending board access を検索し、一括で消化できるようにする。
- pending board access は consume 後に `accepted` へ遷移させ、再実行時は no-op となることを保証する。
- 既存 `board_invites` token は移行期間のみ互換処理を残す。互換 accept でも Team auto-create はせず、Team 招待受諾を前提に変換する。
- `board_invites` の互換 accept は read-only 移行経路としてのみ維持し、新規 write と更新系操作は早期に停止する。

### 4. RLS / Authorization
- RLS は `board_members` を Board 認可の正本として維持しつつ、不整合な `board_members` が存在しない前提へ寄せる。
- Team member 削除後に orphan access が残らないことを、cleanup trigger と policy の両面で確認する。
- 既存 policy のうち Team / Board 境界に依存するものは、`board_members ⊆ team_members` 前提で破綻しないか再確認する。特に profile 可視性と Board member 判定の境界を点検する。
- Team 削除や Team member 削除の直後に、Board selector / timeline / profile lookup の可視性が即時に閉じることを確認する。

### 5. UI / UX
- Team Settings は「Team にメンバーを追加」、Board Settings は「Team メンバーに Board access を付与」に表現を統一する。
- Board Access UI の候補ソースは Team member のみとする。未所属ユーザーは候補に出さない。
- メール直打ちを残す場合は、「Team に招待して、参加後にこの Board に追加する」導線として扱う。
- `guest` の意味を UI に明記する。Team には所属できるが、明示付与された Board のみアクセス可能と説明する。
- Team member 削除確認ダイアログに「この Team 配下のすべての Board access を失う」を表示する。
- 最後の Board owner を外せない場合は、削除前に owner 移譲が必要であることを明示する。
- `Workspace` など旧用語は残さず、`Team`, `Board Access`, `Team Settings` に統一する。
- Board 招待導線を残す場合、UI 文言は「招待」ではなく「Team に招待し、参加後に Board access を付与」に寄せ、内部モデルとの差異を作らない。

### 6. Docs
- `docs/spec/domain-model.md`, `docs/spec/database.md`, `docs/spec/architecture.md`, `docs/spec/components.md`, `docs/spec/testing.md`, `docs/index.md` を更新する。
- 「Board 招待受諾時に Team `guest` 自動追加」の記述を削除する。
- 「Board access は Team membership 前提」「`board_members` は正本だが Team member の subset」を明記する。
- `boards.team_id` の最終 `NOT NULL` 化と、last board owner を理由に Team member 削除が拒否されうる条件を明記する。
- `/board` の bootstrap、team switcher、board selector、Team Settings の説明を最終モデルに合わせる。
- 互換期間中の `board_invites` の扱いは「新規 write 停止、既存 token の限定互換 accept のみ」と明記する。

## Rollout Order
1. 不整合検出 SQL を追加し、orphan `board_members`、`team_id IS NULL` の Board、旧 `board_invites` を把握する。
2. 必要なら既存 orphan `board_members` を `team_members(role=guest)` で補完し、`boards.team_id` も補完する apply SQL を用意する。
3. `board_invites` の新規 write を停止する。
4. `board_members` 追加時の Team membership 必須 reject trigger を入れる。
5. Board 招待 accept の Team auto-guest 生成を止める。
6. Board member 追加 API と Board Access UI を Team member 限定にする。
7. メール直打ち導線を Team invite + pending board access に置き換える。
8. Team member 削除時の board cleanup と last owner 衝突検査を有効化する。
9. 既存 token の accept のみを Phase 2 で互換運用し、Phase 3 で `accept_board_invite()` / `revoke_board_invite()` を完全停止する。
10. `boards.team_id` を `NOT NULL` に引き上げる。
11. docs と E2E を更新して Team-first を固定化する。
12. 互換コードと旧用語を削除し、恒久運用へ移行する。

## Test Plan
- DB:
  - Team 未所属ユーザーへの `board_members` insert / upsert が失敗する。
  - `board_members` への直接 insert / upsert が Team 未所属ユーザーで拒否される。
  - `team_members` 削除で配下 `board_members` が消える。
  - 最後の Board owner を含む Team member 削除が拒否される。
  - `boards.team_id` 補完後に `NOT NULL` 制約が成立する。
  - 不整合検出 SQL が orphan データと `team_id IS NULL` Board を正しく拾う。
  - backfill / invite consume の再実行が冪等である。
- API:
  - Team 未所属ユーザーへの Board access 付与は `TEAM_MEMBERSHIP_REQUIRED`。
  - Team invite 作成、受諾、pending board access 付与が成立する。
  - Team member 削除で Board access も消える。
  - 最後の Board owner を Team から外そうとすると `LAST_BOARD_OWNER_TRANSFER_REQUIRED` で失敗する。
  - 既存 Board 招待導線が内部的に Team invite + pending board access に変換される。
- E2E:
  - Team 未所属ユーザーは Board access 候補に出ない。
  - Team member は Board Settings から role 付きで追加できる。
  - `guest` は Team に所属していても明示付与 Board のみ閲覧できる。
  - Team から削除すると board selector から該当 Board が消える。
  - 最後の Board owner を削除しようとすると owner 移譲が要求される。
  - 既存 `board_invites` token が移行方針どおり処理される。
  - 旧用語が UI 上に残っていない。
- RLS:
  - orphan `board_members` を前提にしなくても既存 policy が成立する。
  - Team member 削除後に profile / board 可視性が意図通り閉じる。
  - Board access だけを持つが Team 所属のない user を想定しなくても policy が破綻しない。
- 既存 permission 系テストは Team-first 前提へ更新し、Playwright は `PW_WORKERS=1` + JSON レポートで固定する。

## Public Interface / Contract Changes
- Board member 追加 API は「Team member であること」が必須条件になる。
- Board 招待 API は新規発行停止、または Team invite + pending access 生成 API へ意味変更する。
- Team member 削除 API は Board access cleanup に加え、last board owner 衝突時の失敗契約を持つ。
- エラー契約として `TEAM_MEMBERSHIP_REQUIRED` を追加する。
- `LAST_BOARD_OWNER_TRANSFER_REQUIRED` を追加する。
- 互換 API は移行期間終了後に削除する。

## Assumptions
- `board_members` 自体は廃止しない。
- Team 所属だけで全 Board 自動アクセスにはしない。
- Personal Team 系の内部フラグは今回の移行では残してよい。
- UX を壊しすぎないため、Board 招待 UI は当面ラッパー化を優先し、内部モデルだけを先に Team-first に揃える。
- 互換期間は短く保ち、旧 trigger と旧 `board_invites` write を長期併存させない。
- backfill と pending access consume は再実行可能な前提で設計する。
