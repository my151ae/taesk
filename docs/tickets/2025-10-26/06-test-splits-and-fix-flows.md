# 06 - テスト分割と失敗修正フロー
**Updated**: 2025-10-27

関連: [05-failing-tests-status.md](./05-failing-tests-status.md)

---

## ゴール
- フルスイートを毎回回さずに、**必要最小限のスイートに分割**して高速に反復できるようにする。
- 現時点で失敗している各 spec を、**再現 → 原因切り分け → 修正 → 検証**の標準フローで確実に直す。

---

## A. 実行スイートの分割戦略

### A-1. 最小健全性（Essential / Core）
- 目的: デプロイ前の**最低限の健全性**を素早く確認する。
- 例:
  ```bash
  # core プロジェクトで最小実行（CI や手元のプリチェック用）
  npx playwright test --project=core --reporter=line
  ```

### A-2. 機能別（Feature）
- 目的: 影響範囲を限定して**短時間で集中検証**する。
- 例（boards / comments / notifications を個別に）:
  ```bash
  # boards
  npx playwright test --project=core --grep "@feature:boards" --reporter=line

  # comments
  npx playwright test --project=core --grep "@feature:comments" --reporter=line

  # notifications
  npx playwright test --project=core --grep "@feature:notifications" --reporter=line
  ```

### A-3. 失敗集中 spec のみ（短期チケット解消モード）
- 目的: **いま落ちている箇所**だけを高速で Fix/Verify 循環。
- 例（05 の現状より）:
  ```bash
  # 単体
  npx playwright test e2e/board-permissions.spec.ts --project=core --reporter=json > rp-board-permissions.json

  # 複数束ねて（boards/kanban/comments/notifications の失敗集中 spec）
  npx playwright test     e2e/board-permissions.spec.ts     e2e/kanban.spec.ts     e2e/comments.spec.ts     e2e/notifications.spec.ts     --project=core --reporter=json > rp-failures.json

  # 実行後に統計をざっと確認（playwright の前置出力を除去して jq）
  sed -n '/^{/,$p' rp-failures.json | jq '.stats'
  ```

> 補足: 長時間化を避けるため、**まずはこの A-3** を回し続けるのが最短で成果が出ます（`修正 → 部分再実行` の反復）。

---

## B. 失敗内容と修正フロー（Spec 別）

> 参照: 05 の「失敗テスト一覧」「Flaky」セクション。下記フローは各 spec での**再現条件**→**原因切り分け**→**修正案**→**検証**の順にまとめています。

### B-1. `e2e/board-permissions.spec.ts`（ケース 4）
**主症状**: ShareDialog の UI 要素が取得できず `expect(locator).toBeVisible` 失敗（リトライでも同様）。

**再現ポイント**
- ダイアログのオープンが**アニメーション中/遅延レンダリング**で、即時に見えない。
- 選択子（selector）が**脆弱（テキスト一致・入れ子深い）**か **role/name が不一致**。

**原因切り分け**
1) ダイアログのトリガー click 直後に、`page.waitForResponse` / `await expect.poll` で **バックエンド応答/DOM 出現**を監視。  
2) `getByRole("dialog", { name: /share/i })` など **role ベース selector** の可視化を `locator.highlight()`（デバッグ）で確認。  
3) コンポーネントが `hidden` / `visibility:hidden` / `opacity` アニメーションの場合、**`toBeVisible` 前に `toBeAttached`** で段階待機。

**修正案**
- selector を **role/testid 起点**に置換（`data-testid="share-dialog"` を付与できるなら最善）。
- ダイアログオープン直後に:
  ```ts
  await expect(dialogLocator).toBeAttached();
  await expect(dialogLocator).toBeVisible();
  ```
- ネットワーク経由データを待つ場合は `await expect.poll(async () => fetchDone())` で **確定待ち**。
- アニメーション完了を待たないとブレる場合は、**CSS transition 無効化**（`:root.disable-anim * { transition: none !important; animation: none !important; }` を test 環境で挿す）。

**検証**
```bash
npx playwright test e2e/board-permissions.spec.ts --project=core --trace on
```

---

### B-2. `e2e/comments.spec.ts`（ケース 7）
**主症状**: CRUD/返信が 90s タイムアウト、@mentions、UUID null チェック、Realtime の可視化などが点在。

**再現ポイント**
- コメント作成後の**永続化/反映待ち**が長い or 条件不十分。
- メンションの**遅延サジェスト**や**Debounce**に未対応。
- UUID 検証が **`null` 前提**だが DB/API は **空文字 or undefined** を返しているなど**契約不一致**。

**原因切り分け**
1) 作成 API を `page.route().fulfill` で**モック**し、**UI 反映のみに集中**してタイムアウト要因を絞る。  
2) メンションは **入力 → サジェスト出現**を `await expect(suggest).toBeVisible()` で明示待機。  
3) UUID 検証は **`null/undefined/""` を正規化**してから assertion。

**修正案**
- **モック優先の UI テスト**に寄せ、CRUD 実リクエストは別の統合テストで担保。  
- メンションは **遅延（debounce）+ 最低入力文字数**に合わせて `type(..., { delay: 20 })` 等を導入。  
- UUID チェックは:
  ```ts
  const normalized = v ?? "";
  expect(normalized).toBe("");
  ```
  など**仕様準拠の期待値**に合わせる。

**検証**
```bash
npx playwright test e2e/comments.spec.ts --project=core --trace on
```

---

### B-3. `e2e/kanban.spec.ts`（ケース 2 + Flaky 10）
**主症状**: D&D に伴う **スナップショット復元**や **toHaveCount / locator.waitFor** 未達、可視性/同期ズレで Flaky。

**再現ポイント**
- `dragAndDrop` の **起点/終点の visibility**、スクロール、重なり（z-index）で失敗。  
- 永続化（サーバ保存）と UI 反映の**タイミング不一致**。

**原因切り分け**
1) D&D ヘルパーで **要素座標/可視性**を明示チェック（`boundingBox()` が `None` の場合はリトライ）。  
2) **仮想スクロール**や**自動並び替え**がある場合、**スクロール完了**を `await page.mouse.wheel` + `await expect(target).toBeInViewport()` で保証。  
3) 永続化は **ポーリング監視**（`expect.poll(() => getServerState())`）で整合を合わせる。

**修正案**
- D&D 前に:
  ```ts
  await expect(source).toBeVisible();
  await expect(target).toBeVisible();
  await expect(target).toBeInViewport();
  ```
- D&D 後は **URL 変更/DB 反映/DOM 数**いずれかの **安定した合図**で assert（`toHaveURL`, `toHaveCount` を `expect.poll` で包む）。  
- **テスト用 data-testid** を D&D 起終点に付け、`getByTestId` に統一。

**検証**
```bash
npx playwright test e2e/kanban.spec.ts --project=core --retries=0 --trace on
```

---

### B-4. `e2e/notifications.spec.ts`（ケース 4）
**主症状**: Web Push の未読が 0、In-app（ベル）で未読/既読/空状態の各シナリオが 90s タイムアウト。

**再現ポイント**
- **Service Worker/Permission** の前提未満で Push を期待している。  
- In-app は **ポーリング or サーバプッシュ**の**偽装データ不足**。

**原因切り分け**
1) `context.grantPermissions(['notifications'])` を明示。  
2) `page.addInitScript` で **SW 登録/Push API** を**モック**。  
3) In-app は **固定ペイロード**を `route().fulfill` で注入し、**UI のみ検証**。

**修正案**
- **Push/通知は UI スタブ**に切替、**既読操作の副作用**（未読数減少/既読マーク）が DOM と整合するかを見る。  
- サーバ側統合は **別レイヤ**（API テスト or 少数 e2e に限定）。

**検証**
```bash
npx playwright test e2e/notifications.spec.ts --project=core --trace on
```

---

## C. ワークフロー（推奨）
1) **Core/Essential** を回して基盤健全性を確認（速い）。  
2) **A-3 の失敗集中 spec** を JSON レポーター付きで回し、**修正→再実行**を高速反復。  
3) 機能別（A-2）で仕上げ。  
4) 仕上げに **フル**（`--project=full`）で広範確認。

---

## D. 付録：失敗 spec の自動抽出 → 再実行（スニペット）

### D-1. Bash + jq（Playwright レポートから抽出）
```bash
# 1) 実行（JSON レポーター）
npx playwright test --project=core --reporter=json > rp.json || true

# 2) 先頭ログを除去して JSON 部分だけに
sed -n '/^{/,$p' rp.json > rp.jsonl

# 3) 失敗した spec パスを unique で抽出
jq -r '..|.error? // empty | input_filename' rp.jsonl | sed 's#:.*$##' | sort -u > failed-specs.txt

# 4) 再実行
if [ -s failed-specs.txt ]; then
  xargs -a failed-specs.txt npx playwright test --project=core --reporter=line
fi
```

### D-2. npm-script（例）
```jsonc
// package.json (scripts)
{
  "scripts": {
    "test:core": "playwright test --project=core",
    "test:failed": "bash scripts/test-rerun-failed.sh"
  }
}
```

---

## E. チェックリスト（完了条件）
- [ ] board-permissions: ダイアログ取得の selector/待機を修正し、全ケース成功。  
- [ ] comments: CRUD/メンション/UUID/Realtime の各タイムアウト解消（モック化＋正規化）。  
- [ ] kanban: D&D 安定化（可視性/スクロール/ポーリング）＋ Flaky 0。  
- [ ] notifications: Push を UI スタブで再設計し、未読/既読/空状態の 3 シナリオ成功。  
- [ ] スクリプト類（A-3/D）が repo に追加・共有されている。

---

### 備考
- 実行時間短縮の基本は **「ネットワーク依存の e2e を UI スタブに寄せる」**こと。サーバ/統合の保証は **別枠テスト**に分離し、e2e は UI の**見え方と行動**に集中させると安定します。
