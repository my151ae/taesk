# Playwright Batch Status (2026-03-14)

最終更新: 2026-03-14 JST

## 実行結果

- `auth`: green
- `timeline`: `unexpected: 0`, `flaky: 1`
- `comments`: fail
- `comments:modal`: green
- `notifications`: green
- `reorder`: green
- `permissions`: fail
- `permissions:ui`: green
- `permissions:api`: fail
- `rls`: 実行結果 `expected: 0`, `unexpected: 0`

## 失敗内容の要約

### comments

- 対象: `should edit tags from header actions in modal`
- 症状: `card-modal-tags-button` が常に visible とは限らず、overflow menu 側へ寄るケースがある
- 対応: locator を inline/overflow 両対応に修正し、`comments:modal` は green 化

### permissions

- UI 系: `share-button` / `Share Board` 前提が古かった。board menu の `Edit` → `Board Settings` → `Board Access` フローに更新して green 化
- API 系: `POST /api/boards` の期待 status が現実とずれるケースあり
- 対応方針: `@permissions:ui` と `@permissions:api` に分割し、UI 導線変更と API 期待値変更を別々に詰める

### permissions:api の残件

- `should allow board creation for members when team setting permits it @permissions:api`
  - 期待 `201`
  - 実際 `500`
- `should reject board creation across team boundaries @permissions:api`
  - 期待 `403`
  - 実際 `404`

## 分割実行

```bash
PW_WORKERS=1 npm run test:comments:modal -- --reporter=json > test-results/playwright-comments-modal.json
PW_WORKERS=1 npm run test:comments:crud -- --reporter=json > test-results/playwright-comments-crud.json
PW_WORKERS=1 npm run test:comments:mentions -- --reporter=json > test-results/playwright-comments-mentions.json
PW_WORKERS=1 npm run test:permissions:ui -- --reporter=json > test-results/playwright-permissions-ui.json
PW_WORKERS=1 npm run test:permissions:api -- --reporter=json > test-results/playwright-permissions-api.json
```
