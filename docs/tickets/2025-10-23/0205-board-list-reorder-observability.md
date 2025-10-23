# 0205 リスト並び替え監視・ログ拡張

**作成日**: 2025-10-23
**関連仕様**: `docs/tickets/2025-10-23/02-board-list-reorder-spec.md`
**担当候補**: BE / SRE

---

## 🎯 ゴール
- `lists.reorder` / `lists.renumber` ログに `issues` や `payloadHash` などのメタデータを追加し、失敗時の原因追跡を容易にする
- CloudWatch / Supabase ログ基盤へ成功率・処理時間 p95 をメトリクス送信
- 監視ダッシュボードとアラート条件（失敗率 > 5% など）を定義

## 📝 背景
- 現状ログは `updated`/`unchanged`/`durationMs` のみで、`issues` 内容や payload の特定ができない
- doc 02 の #9 「監視・ログ」で求めている情報粒度に未到達

## ✅ スコープ
- `app/api/boards/[boardId]/lists/reorder/route.ts` のログ出力に `issues`（省略版）と `updatesCount`、`payloadHash` を追加
- Supabase もしくは Next.js 側から監視ツール（例: Datadog, CloudWatch EMF）へのメトリクス送信機構を追加
- 失敗時 (4xx/5xx) のログ分類（`severity: warning/error`）を統一
- `docs/operations/monitoring.md` にアラート条件・ダッシュボードリンクを追記

## 🚫 非スコープ
- 新規監視基盤そのものの立ち上げ（既存パイプラインを利用）
- カード並び替えログ（別途検討）

## 📦 実装タスク
1. **構造化ログ**
   - `console.log(JSON.stringify({...}))` の payload に `issues`（最大 5件）、`payloadHash`（SHA-1 等）を追加
   - `console.error` も JSON 形式に統一
2. **メトリクス送信**
   - `durationMs` と `status` をメトリクス化し、Lambda/CloudWatch へ送信する helper を追加
   - 失敗時に `issues[].code` をメトリクスタグへ含める
3. **アラート/ドキュメント**
   - 監視ダッシュボードのスクリーンショット/URL を `docs/operations/monitoring.md` に追記
   - 失敗率 5% 超で PagerDuty or Slack へ通知するルールを記載
4. **ローカル検証**
   - `supabase` ログ出力が想定通りであることをローカル環境で確認

## ✅ 受け入れ基準
- [ ] `lists.reorder` 成功/失敗のログに `issues` 情報が含まれる
- [ ] メトリクスダッシュボードで成功率/失敗率/処理時間を確認できる
- [ ] アラート条件がドキュメント化され、手順に従って検証できる

## 🧪 テスト
- [ ] `npx playwright test --project=core --grep @feature:lists --reporter=json > playwright-report.json`
- [ ] `cat playwright-report.json | jq '.stats'`
- [ ] ログ出力は `sed -n '/{"event":"lists.reorder"/p' .next/logs/app.log` 等で確認（環境に応じて調整）

## 📎 依存関係
- ログ集約基盤（CloudWatch/Datadog）構成
- 0201/0202 のテスト・エラー表示と整合を取る必要あり

## ❓ オープン課題
- `issues` が多い場合のログ肥大化対策（上限 5件でトリミング）
- 個人情報（リスト名など）のマスキング方針
