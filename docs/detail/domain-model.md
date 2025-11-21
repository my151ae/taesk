# Domain Model

Taesk のドメインモデルは、**Timeline** と **A/B Buckets** という2つの主要な概念を中心に構成されています。これらは、ユーザーが「いつ」「何を」すべきかを直感的に計画・実行するための基盤です。

## Core Concepts

### 1. Board (ボード)
プロジェクトやタスク管理の最上位コンテナです。
- **Timeline View**: ボードは現在、Timeline View を唯一のインターフェースとして提供します。
- **Members**: ボードには複数のメンバーが所属し、権限（Owner, Editor, Commenter, Viewer）によって操作が制限されます。

### 2. Card (カード)
タスクや予定を表す最小単位です。カードは以下のいずれかの「チャンネル (`due_channel`)」に属します。

| Channel | Description | UI Representation |
| :--- | :--- | :--- |
| **Timeline** | 時間が決まっている予定 | Today/Tomorrow の 24時間グリッド上に配置 |
| **A/B List** | 時間は決まっていないが、今日/明日やるべきタスク | A/B バケット (Today A/B, Tomorrow A/B) に配置 |
| **List-only** | (Legacy) 旧 Kanban リスト | Timeline UI には表示されない |
| **Archived** | 完了または不要になったタスク | アーカイブ済み |

### 3. Timeline (タイムライン)
「時間」を軸にした計画ビューです。
- **Scope**: 今日 (Today) と 明日 (Tomorrow) の2日間のみを表示します。
- **Granularity**: 1分単位の精度を持ちますが、UI上は適度なスナップ（15分など）が適用されます。
- **JST Canonical**: すべての日付・時刻計算は日本標準時 (JST) を基準に行われます。

### 4. A/B Buckets (A/B バケット)
「優先度」と「タイミング」を軸にしたタスクのグルーピングです。
Timeline の隙間時間を埋めるタスクを管理するために使用します。

- **Today A**: 今日やるべき、優先度が高いタスク
- **Today B**: 今日できればやる、または A の次にやるタスク
- **Tomorrow A**: 明日やるべきタスク
- **Tomorrow B**: 明日以降でも良いタスク

カードはバケット内で `due_bucket_position` によって並び替えられます。

## Data Flow & Synchronization

### Realtime Updates
Supabase Realtime を利用して、他のユーザーの操作（カードの移動、編集、コメント）が即座に画面に反映されます。

### Offline-First (Sync Queue)
ネットワーク接続が不安定な場合でも操作を継続できるよう、変更内容は一時的にローカルストレージ (`taesk-sync-queue`) に保存され、オンライン復帰時に順次サーバーへ同期されます。

## Domain Relationships

```mermaid
erDiagram
    BOARD ||--o{ CARD : contains
    BOARD ||--o{ MEMBER : has
    CARD ||--o{ COMMENT : has
    MEMBER ||--o{ COMMENT : writes

    CARD {
        string due_channel "timeline | ab-list"
        string due_bucket "today_a | today_b..."
        time due_start
        time due_end
    }
```
