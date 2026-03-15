# Deployment Guide (Timeline Board)

Taesk の Timeline ボードは **Next.js 16 + Vercel** をフロントエンドとして、**Supabase** をデータストア/認証/Realtime 基盤として使用します。ここではデプロイ構成、環境変数、Supabase マイグレーション、RLS、運用時のチェックリストをまとめます。

## 1. Overview

- **Hosting**: Vercel（Node.js runtime）。`npm run build` を実行し `.next/` を配備。
- **Database/Auth**: Supabase。Team を上位コンテナ、Board を Team 配下として扱い、Board 単位の認可は `board_members` を正本として実施する。ただし `board_members` は同じ Team の `team_members` に限定する。
- **Restrictions**: 手動 `npm run dev` 禁止。検証は Playwright JSON レポートと chrome-devtools MCP を利用。

## 2. Pre-flight Checklist

1. `main` ブランチに最新の Timeline コードがあること。
2. Supabase プロジェクトへ以下のマイグレーションが適用済み:
   - `20251113090000_add_due_fields.sql`
   - `20251117091500_add_due_bucket_position.sql`
   - `20251111090000_add_card_checked_flag.sql`
3. `.env.local` / `.env.test` / Vercel 環境変数が更新されていること（`due_*` フィールドに関連する追加設定は不要）。
4. `npm run lint` および `npm run test:all-split` がローカル/CI で成功していること。テストレポート (`test-results/batches/*.json`) を `docs/tickets/` にリンク。

## 3. Vercel Deployment

### 初回セットアップ

1. [Vercel](https://vercel.com) で「Import Project」を選択し、リポジトリ `my151ae/taesk` を指定。
2. Build 設定:
   ```
   Framework Preset: Next.js
   Install Command: npm install
   Build Command: npm run build
   Output Directory: .next
   ```
3. 環境変数を Production / Preview / Development すべてに設定:
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=replace-with-your-supabase-service-role-key   # API ルートでの管理操作に使用
   NEXT_PUBLIC_DISABLE_REALTIME=false
   NODE_ENV=production
   ```
   必要に応じて通知/Push 関連のキー（`NEXT_PUBLIC_VAPID_PUBLIC_KEY` など）も追加する。

4. 「Deploy」を押して初回デプロイを実施。完了すれば `https://taesk.vercel.app` で Timeline UI が利用できる。

### デプロイフロー

```
git push origin main
  ↓ GitHub hook
Vercel build (npm install → npm run build)
  ↓
Vercel deploys .next/
  ↓
Timeline board available at taesk.vercel.app
```

### 注意事項

- `npm run dev` を Vercel で実行させない。Next.js dev server は Playwright の `webServer.command` のみが起動する。
- Supabase URL/Key を rotate した場合は、Vercel 側の環境変数と `.env.test` を同時に更新し、Playwright auth キャッシュ (`playwright/.auth/user.json`) を削除して再ログインする。
- Deployment preview でも Supabase 本番環境を参照するため、テストデータ作成時は `is_test_board=true` を必ずセット。

## 4. Supabase Setup

### 環境作成

1. [Supabase](https://supabase.com) で新規プロジェクトを作成。
2. 「Project URL」「Anon Key」「Service Role Key」を控える。
3. `supabase/migrations` を順序通りに適用。MCP か Supabase CLI (`supabase db push`) を利用。

### RLS ポリシー

Timeline では Team 配下で Board access が成立し、最終的な Board 単位認可は `board_members` を基準にカード閲覧/編集を制限します。

```sql
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read board"
  ON public.boards FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.board_members
    WHERE board_members.board_id = boards.id
      AND board_members.profile_id = auth.uid()
  ));

CREATE POLICY "Members can manage cards"
  ON public.cards FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.board_members
    WHERE board_members.board_id = cards.board_id
      AND board_members.profile_id = auth.uid()
  ));
```

コメントや通知も同様に `board_id` や `recipient_id` をキーにポリシーを定義する。Board access の付与は Team membership を前提とし、外部メール招待は Team invite を正本として pending board access を消化する。テスト専用ユーザー ID (`TEST_USER_ID`) には先に `team_members` を付与したうえで `board_members` を upsert し、Timeline API を通過できるようにする。

### Edge Functions / Push

- Web Push 送信は `supabase/functions/send-push-notification` を利用。Vercel から呼び出す場合は Service Role Key を使用する。
- `notification_delivery_logs` で配信履歴を追跡し、Timeline ヘッダーの NotificationSettings から `test push` を実行して検証する。

## 5. Testing Before Deploy

- `npm run test:all-split` をローカルまたは CI で実行し、`test-results/batches/*.json` を `docs/tickets/<date>` へ添付。Timeline バッチ（`e2e/timeline.spec.ts`）を含む 7 バッチが成功するまでリトライする。
- Comments バッチが Flaky の場合: `npm run test:comments` で単体再実行 → 成功ログを `docs/tickets/` へ記録 → `npm run test:all-split` を再実施。
- テスト中は `PW_WORKERS=1` を守り、`npx playwright test --reporter=json` を必ず指定する。

## 6. Observability

- **Vercel**: Deploy Logs, Web Analytics, Edge Logs を利用。Timeline 特有の遅延（`board-load p95 > 3s` など）は Playwright の JSON レポート（`test-results/batches/*.json`）や `dumpClientMetrics` の出力と合わせて監視する。
- **Supabase**: Database Logs / Realtime Logs / Edge Function Logs で API 失敗や Realtime 切断を調査。
- **docs/tickets/**: 各デプロイ日の Playwright ログとメトリクスサマリーを残す。Timeline のクライアントトレース (`dumpClientMetrics`) も同フォルダに保存する。

## 7. Troubleshooting

| 事象 | 原因/対処 |
| --- | --- |
| `cards` 取得で `42703 column "due_bucket" does not exist` | Supabase で `20251113090000_add_due_fields.sql` が未適用。マイグレーションを実行し、`idx_cards_board_due_date` を含めて再構築する。 |
| Timeline API が 401 を返す | `playwright/.auth/user.json` が期限切れ。ファイルを削除して Playwright を再実行すると自動で再ログインする。 |
| Vercel build が失敗 (`NEXT_PUBLIC_SUPABASE_URL is not defined`) | 環境変数を Production/Preview/Development すべてに設定しているか確認。 |
| `npm run test:all-split` が `auth` バッチで停止 | `lsof -i :3000` で dev server 残存を確認し、`pkill -f 'node .*next dev'` → `pkill -f 'playwright test'` を実行してから再開。 |

## 8. Custom Domains

1. Vercel プロジェクト設定でカスタムドメインを追加。
2. DNS に A / CNAME レコードを設定。
3. SSL 証明書は Vercel が自動発行する。Timeline 特有の追加設定は不要。

Timeline ボードは上記構成でデプロイされ、Kanban 遺産に依存せず Today/Tomorrow 計画と A/B 管理を提供します。デプロイ作業時は常に Playwright JSON レポートと `docs/tickets/` のログを添えて変更内容を共有してください。
