**v3仕様では「Google → Taesk の取り込み」も含めてできる前提**で設計されていて、今はそこまで実装がつながってないだけ、という整理で問題ありません。
（方針は①Webhook取り込み＋②「今すぐ同期」での pull→push の **両方を採用**、③の手動ワークアラウンドは基本ナシの方向にしています）

---

# Taesk v3 Googleカレンダー連携

## 取り込み＆更新方針（最新更新優先）

## 1. 前提・ゴール

* 対象: Taesk v3 の Google カレンダー連携（GCard / TCard(SyncOn/Off) 周り）。
* 現状:

  * Taesk → Google への書き戻しは動いている。
  * Google → Taesk への取り込み（差分 fetch）が Webhook や「今すぐ同期」と **つながっていない**。
  * 結果として、Google 側を編集しても Taesk 側カードに反映されず、「今すぐ同期」で **古い Taesk の内容を Google に上書き**してしまう。
* ゴール:

  * **Google 側の変更が Taesk 側カードに反映される**こと。
  * **更新競合は「最新更新優先」(latest-wins)** で処理すること。

    * Google の更新時刻が新しければ **Google を正として Taesk を更新**。
    * Taesk の更新時刻が新しければ **Taesk を正として Google に書き戻し**。

---

## 2. 同期の基本方針（決定事項）

### 2.1 同期方向

* **双方向同期**を前提とする。

  * Google → Taesk: Google カレンダーのイベントを GCard/TCard に取り込み、カード表示に反映。
  * Taesk → Google: TCard(SyncOn) を Google カレンダーに書き戻し。

### 2.2 更新競合ルール：最新更新優先

* 各イベント（Google event ↔ GCard/TCard）に対して、少なくとも以下の更新情報を持つ：

  * `google_updated_at`（Google イベントの `updated` など）
  * `taesk_updated_at`（Taesk 側カードの最終更新時刻）
* 同期時のルール:

  * `google_updated_at > taesk_updated_at` の場合
    → **Google の内容を採用**し、Taesk のカードを上書きする。
  * `taesk_updated_at >= google_updated_at` の場合
    → **Taesk の内容を採用**し、Google 側イベントを Taesk 内容で上書きする（書き戻し）。
* 削除/キャンセル時:

  * Google 側が `status=cancelled` や削除の場合は、対応する TCard(SyncOn) を **TCard(SyncOff)** に落とす（Taesk 側からは消さず、「外部同期オフ」にする）。

### 2.3 同期トリガの方針

**採用するのは以下の2系統：**

1. **Webhook トリガ**

   * Google の push 通知を受けたら、対象カレンダー/ユーザーに対して **Google → Taesk の pull（差分取り込み）を実行**する。
   * 実処理はワーカー/ジョブに投げる。

2. **「今すぐ同期」押下時**

   * ユーザーが手動で同期したいときは、必ず

     1. **先に Google → Taesk の pull（取り込み）**
     2. その後 Taesk → Google の書き戻し
   * この順に実行して、「古いTaesk → Google上書き」が起きないようにする。

**方針として採用しない（or 優先しない）もの:**

* 「取り込み専用の手動エンドポイントをUIに出す」ワークアラウンドは、
  Webhook＋「今すぐ同期」改修で代替できるため、基本は採用しない。

---

## 3. 実装タスク（エンジニア向け指示）

### 3.1 共通取り込みサービス関数の実装（Backend）

**目的:** どこからでも呼べる **Google → Taesk 取り込み処理**を 1 箇所にまとめる。

* 例: `syncGoogleCalendarToTaesk(userId, calendarId, options)` のような関数/サービスを実装。
* やること:

  1. `syncToken` を使った `listEvents` の差分取得（初回はフル取得）。
  2. v3仕様の対象レンジ（例: 過去4週〜未来12週など）に絞り込んで、対象イベントを列挙。
  3. 各イベントについて、

     * 対応する GCard/TCard を紐づけ。
     * `google_updated_at` と `taesk_updated_at` を比較し、**最新更新優先ルール**に従って、

       * Taesk カード更新 or
       * Google イベント更新 を決定。
  4. Google 側削除/キャンセルイベントに対しては、

     * TCard(SyncOn) → TCard(SyncOff) に降格する。
  5. 最後に `syncToken` を更新して保存。
* 受け入れ条件（例）:

  * Google でタイトルを変更 → `syncGoogleCalendarToTaesk` 実行後、対応するカードのタイトルが更新される。
  * Google 側で削除 → 実行後、Taesk 側はカードが残りつつ SyncOff になる。

### 3.2 「今すぐ同期」APIの改修（Backend）

**目的:** ユーザー操作時は必ず「最新Google → Taesk → Google」の順で安全に同期する。

* 「今すぐ同期」API のサーバ側処理を次の順序に変更：

  1. `syncGoogleCalendarToTaesk(userId, calendarId, {reason: "manual_sync"})`
     → Google の最新状態を Taesk に取り込み（pull）。
  2. 取り込み完了後、TCard(SyncOn) を対象に Google へ書き戻し（push）。

     * このときも `google_updated_at` と `taesk_updated_at` を比較（念のため冪等に）。

* 受け入れ条件（例）:

  1. Google でタイトルを「タイトルA → タイトルB」に変更。
  2. Taesk 画面上のカードはまだAのまま。
  3. 「今すぐ同期」ボタンを押す。
  4. 数秒後、

     * Taesk のカードタイトルが **B** に更新される。
     * さらに Taesk 側で変更した内容があれば、その上で Google にも反映される。

### 3.3 Webhook ハンドラの改修（Backend）

**目的:** v3仕様どおり、Google 側での変更を自動的に Taesk に取り込む。

* `/api/integrations/google-calendar/webhook` の振る舞いを変更：

  * 現状: ログ出力のみ。
  * 改修後:

    1. 通知から対象の `userId` と `calendarId` を解決。
    2. 非同期ジョブキューに `syncGoogleCalendarToTaesk(userId, calendarId, {reason: "webhook"})` を enqueue。
    3. 同一カレンダーへの通知が短時間に連続する場合でも、冪等・まとめ処理できるよう配慮（ジョブのデデュプリケーションなど）。
* 受け入れ条件（例）:

  * Google 側で予定を編集 → しばらく待つと、Taesk 側カードが自動的に更新される（ページ再読込 or リアルタイム購読で確認）。

### 3.4 フロントエンド対応（「今すぐ同期」）

**目的:** Backend改修に合わせて、ユーザー体験と状態表示を整える。

* 「今すぐ同期」ボタン押下で呼ぶ API は、**3.2 で改修したエンドポイントに統一**。
* UI 上の挙動:

  * ボタン押下 → ローディング状態（例: スピナー＋「Google と同期中…」）。
  * 成功 → トースト等で「同期完了」を表示。
* Realtime:

  * `cards` テーブルの更新がフロントに流れてくる前提なので、別途 re-fetch は不要な想定（必要に応じて確認）。

### 3.5 移行・確認項目

* 既存の watch 状態・syncToken が残っている場合、極端な差分が溜まっていないか確認。

  * 問題があれば一度 watch を貼り直す or フル同期を走らせる。
* 本番データでの確認:

  * 実際に 1〜2ユーザーのカレンダーで E2E テストを行い、

    * Google 更新 → Webhook 経由で Taesk 反映
    * 「今すぐ同期」押下で pull→push の順になっている
  * を確認する。

---

## 4. チケット切り出し例

### Backend

* **BE-1:** `syncGoogleCalendarToTaesk` の実装
* **BE-2:** 「今すぐ同期」API を pull→push の順に改修
* **BE-3:** Webhook ハンドラから `syncGoogleCalendarToTaesk` を呼ぶジョブ実装

### Frontend

* **FE-1:** 「今すぐ同期」ボタンのAPIエンドポイントを BE-2 に合わせて更新
* **FE-2:** 同期中インジケータと完了トーストの表示確認
