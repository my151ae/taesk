# Supabase MCP 認証手順（Codex Desktop）

Supabase からの Security Advisor 警告を MCP 経由で確認・対応するための手順。

## 1. 前提

- `~/.codex/config.toml` に Supabase MCP が定義されていること
- サーバー設定例:

```toml
[mcp_servers.supabase]
url = "https://mcp.supabase.com/mcp"
type = "sse"
```

## 2. OAuth 認証

```bash
codex mcp login supabase
```

- 表示された URL をブラウザで開く
- Supabase 側で許可する
- CLI に `Successfully logged in to MCP server 'supabase'.` が表示されれば成功

## 3. 接続確認（重要）

Supabase MCP では `resources/list` が未提供のため、以下を疎通確認の基準にする。

```bash
codex mcp list
```

加えて、Codex から `mcp__supabase__list_projects` を呼び、プロジェクト一覧が返ることを確認する。

## 4. よくある失敗

### OAuth token refresh failed

症状例:

- `OAuth token refresh failed: Failed to parse server response`

対応:

1. `codex mcp login supabase` を再実行
2. OAuth を再許可
3. Codex Desktop を再起動してセッションを開き直す
4. `mcp__supabase__list_projects` を再実行

### Method not found (resources/list)

症状例:

- `resources/list failed: Mcp error: -32601: Method not found`

これは Supabase MCP の `resources/*` 未実装によるもので、接続失敗とは限らない。
`mcp__supabase__list_projects` / `mcp__supabase__get_advisors` が成功すれば実運用上は接続済み。

## 5. Security Advisor の取得手順

1. `mcp__supabase__list_projects`
2. 対象 `project_id` を特定
3. `mcp__supabase__get_advisors`（`type: security`）
4. `ERROR` を最優先で修正し、再度 `get_advisors` で残件を確認

## 6. 運用ルール

- セキュリティ修正は必ず `supabase/migrations/*.sql` に記録する
- 作業後は Advisor を再取得し、結果をドキュメント化する
- アプリ影響が大きい変更（RLS/ポリシー差し替え）は段階的に適用する

## 7. 既知の残件（2026-02-18時点）

- `Leaked Password Protection Disabled` は Supabase の **Pro Plan 以上** で有効化可能。
- 対応はダッシュボードの Auth 設定で行う（MCP の SQL/プロジェクト API では切替不可）。
- Free プランではこの WARN が残るため、移行前提の残件として扱う。
