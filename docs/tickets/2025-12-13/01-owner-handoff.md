# 01-主催者移譲（Taesk × Google カレンダー）仕様

> 前提の運用：  
> **Aがタスク（TCard）を作成 → タイムラインで主担当/実行役をBに設定 → BのGoogleカレンダーに表示し、Aのカレンダーからは消す。**  
> 実現方式は **一時ACLハンドシェイク → `events.move`（正式な主催者変更）**。

---

## 1. 目的 / スコープ
- **目的**：Taesk上の責務変更（A→B）にあわせて、Googleカレンダーの**主催者**をAからBへ移譲し、予定の“連続性（iCalUID/ゲスト/スレッド）”を保ったまま**Aのカレンダーから消し、Bのカレンダーに出す**。
- **対象**：Google Calendar **通常イベント（`eventType=default`）**。Birthday/Out of office/Focus time/Working location/FromGmail等は**非対象**（`events.move`不可）。
- **非スコープ**：メール承認ベースの主催者変更UI代行（APIでの承認クリックは不可）。

> リポジトリは「01-*.md」で仕様を整理する構成を採用しています（例：`specifications/01-architecture.md`）。本ドキュメントはその流儀に合わせた“01-”仕様です。

---

## 2. 前提条件（Auth/権限）
- A/Bの各ユーザーが **TaeskにGoogle連携（OAuth）** 済み。
- 要求スコープ（最小）  
  - **A**：`https://www.googleapis.com/auth/calendar.events`（Aカレンダーのイベント操作）  
  - **B**：`https://www.googleapis.com/auth/calendar.acls`（Bカレンダーへの一時共有付与/回収）  
  - 表示やメタ更新が必要なら `calendar.readonly` も併用可。
- Taeskは**アクセストークン/リフレッシュトークンを安全に保管**（KMS/HSM などで暗号化）。

---

## 3. 用語
- **TCard**：Taeskのタスクカード。
- **GEvent**：Googleカレンダーのイベント。
- **LinkedEvent**：TCardとGEventの連携情報（`calendarId`,`eventId`,`iCalUID`,`etag`,`ownerTaeskUserId` など）。
- **一時ACLハンドシェイク**：`acl.insert` で**短時間だけ**片方向の writer を付与→移譲完了後に `acl.delete` で回収。

---

## 4. ユースケース（基本フロー）
1) **AがTCardを作成**。必要なら A のカレンダーに仮イベント（GEvent）を作成。  
2) タイムラインで **主担当/実行役にBを設定** → 「主催者をBへ移譲」を選択。  
3) **一時ACLハンドシェイク**（B→A の writer 付与）：  
   - BがTaesk内の承認ボタンを押下 → Taeskは **Bのトークン**で  
     `acl.insert(calendarId=B.primary, role=writer, scope={type:'user', value:A.email})`。  
   - TTL（例：10分）つきの“移譲セッション”を作成して追跡。  
4) **主催者変更の実行**（正式）：  
   - Taeskは **Aのトークン**で `events.move` を実行：  
     `POST /calendars/{A.primary}/events/{eventId}/move?destination={B.primary}&sendUpdates=all`  
   - 結果：**主催者＝B** に切替。ゲストや iCalUID は引き継がれる。  
5) **クリーンアップ**：  
   - Taeskは **Bのトークン**で `acl.delete`（Bカレンダー上の A→writer 付与を回収）。  
   - LinkedEvent を **B側の`calendarId/eventId` に更新**。A側のリンクは履歴に残すか無効化。  
6) 以降、Taeskでは **Bのカレンダー上のGEvent** を正とし、変更検知（watch/ETag）で同期。

> 通知メールは `sendUpdates` で制御（`all`/`externalOnly`/`none`）。プロダクトポリシーに合わせて選択。

---

## 5. API 呼び出し詳細（擬似コード）

### 5.1 一時ACL付与（B→A）
```http
POST https://www.googleapis.com/calendar/v3/calendars/{B.primary}/acl
Authorization: Bearer {B_access_token}
Content-Type: application/json

{
  "role": "writer",
  "scope": { "type": "user", "value": "{A.email}" }
}
```
- 成功後、TTLタイマーを開始（例：10分）。失敗時はユーザーに再試行UI。

### 5.2 主催者変更（A→B へ move）
```http
POST https://www.googleapis.com/calendar/v3/calendars/{A.primary}/events/{eventId}/move?destination={B.primary}&sendUpdates=all
Authorization: Bearer {A_access_token}
```
- 戻り値の `id`/`iCalUID`/`organizer`/`attendees` を保存し、LinkedEvent を更新。

### 5.3 ACL回収（BカレンダーからAのwriterを削除）
```http
DELETE https://www.googleapis.com/calendar/v3/calendars/{B.primary}/acl/{ruleId_for_A}
Authorization: Bearer {B_access_token}
```
- 例外時も **finally で回収**（定期クリーンアップも用意）。

---

## 6. データモデル（最低限）
```ts
type LinkedEvent = {
  cardId: string;
  calendarId: string;   // "primary" or specific ID
  eventId: string;
  iCalUID: string;
  etag: string;
  ownerTaeskUserId: string;  // A or B
  lastSyncedAt: string;
};
```
- **iCalUID** をキーに、A/Bの複数カレンダー上の“同一イベント”を突き合わせ可能。

---

## 7. エラー処理 / ロールバック
- `403/404`：権限不足・対象なし → 一時ACLを検証/再付与、またはユーザーに再承認を促す。
- `events.move` 失敗時：
  - まだA側に残っているなら**何もしない**（表示はAのまま）。
  - 片方だけ成功の恐れがある場合は**コンペンセイション**（例：`move`が失敗したらACL回収のみ実施）。
- **finally**：ACL回収（`acl.delete`）、セッション`status`を失敗で確定・監査ログ出力。

---

## 8. 監査 / セキュリティ
- **監査ログ**：誰が・誰に・どのイベントを・いつ移譲したか（リクエストID/レスポンスETag）。
- **最小権限**：通常時は各自のカレンダーのみ操作。移譲時のみ**短時間のwriter付与**→完了後回収。
- **TTL/自動清掃**：ACL付与のメタ（作成時刻・有効期限）を保持し、期限切れはバッチ削除。
- **トークン保護**：DB暗号化、即時revoke UI、PII/機微情報の最小化（件名や本文をログに残さない）。

---

## 9. UXメモ
- **2クリック合意**：Aが移譲開始 → Bが承認（ACL付与）。
- **通知**：`sendUpdates` の既定は `all`（プロダクトで方針決定）。
- **わかりやすい失敗復元**：失敗時は「Aのままに戻した」トースト＋再試行ボタン。

---

## 10. エッジケース
- **繰り返し予定**：インスタンス単体は主催者変更不可。シリーズ親イベントで処理し、例外は別設計。
- **特殊イベント**：Birthday/Out of office/Focus time 等は `move` 不可。UIで抑止。
- **タイムゾーン/DST**：保存はUTC、表示はローカル。日跨ぎ・終日イベントの扱いを統一。

---

## 11. 代替方式（参考）
- **クローン＆削除**：
  - BのトークンでBカレンダーに `events.insert`（`sendUpdates`調整）、Aのトークンで元を`events.delete`。  
  - 簡単で安全だが**別イベント**になる（iCalUID/Meet URL が変わる等）。
- **メール承認フロー**：Google標準の「主催者変更」メールで承認 → Taeskは結果を同期（完全自動ではない）。

---

## 12. 成果物 / 設置場所
- 本ドキュメントはリポジトリの **`doc/specifications/01-` 系**として配置想定（例：`01-owner-handoff.md`）。

