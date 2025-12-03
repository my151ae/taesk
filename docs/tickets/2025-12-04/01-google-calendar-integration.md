# Googleカレンダー連携調査

## 概要
TaeskアプリケーションとGoogleカレンダーの相互連携についての調査と実装計画

## 連携の可能性

### ✅ 実装可能な機能

#### 1. 読み取り（カレンダー予定の表示）
- **難易度**: ⭐⭐☆☆☆（比較的簡単）
- **実装内容**:
  - ユーザーのGoogleカレンダーの予定を取得
  - 特定期間（日付範囲）の予定一覧を表示
  - 予定の詳細情報（タイトル、時間、説明、場所など）を取得
  - タイムラインビューに統合表示

#### 2. 書き込み（予定の作成・編集）
- **難易度**: ⭐⭐☆☆☆（読み取りとほぼ同じ）
- **実装内容**:
  - Taeskタスクから新しい予定をGoogleカレンダーに作成
  - 既存の予定を更新・削除
  - リマインダーの設定
  - カレンダーイベントへのリンク追加

#### 3. 双方向同期（高度）
- **難易度**: ⭐⭐⭐⭐☆（Webhook実装が必要）
- **実装内容**:
  - リアルタイムでの変更検知
  - 競合解決のロジック
  - 自動同期機能

## 技術仕様

### 使用API
- **Google Calendar API v3**
- OAuth 2.0認証

### 必要な権限スコープ
```
https://www.googleapis.com/auth/calendar.readonly      # 読み取り専用
https://www.googleapis.com/auth/calendar.events        # イベント作成・編集
https://www.googleapis.com/auth/calendar               # フルアクセス
```

## 実装手順

### Phase 1: 環境セットアップ（1-2時間）

#### 1.1 Google Cloud Console設定
- [ ] Google Cloud Consoleでプロジェクト作成
- [ ] Google Calendar API有効化
- [ ] OAuth 2.0クライアントIDとシークレット取得
- [ ] 承認済みリダイレクトURIの設定
  - 開発: `http://localhost:3000/api/auth/callback/google`
  - 本番: `https://yourdomain.com/api/auth/callback/google`

#### 1.2 パッケージインストール
```bash
npm install googleapis
npm install next-auth  # 既にインストール済みの可能性あり
```

#### 1.3 環境変数設定
`.env.local`に以下を追加:
```env
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your_secret_key
```

### Phase 2: 認証実装（2-4時間）

#### 2.1 NextAuth設定
`app/api/auth/[...nextauth]/route.ts`を作成または更新:

```typescript
import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: 'openid email profile https://www.googleapis.com/auth/calendar.readonly',
          access_type: 'offline',
          prompt: 'consent',
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
      }
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken;
      return session;
    },
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
```

#### 2.2 TypeScript型定義
`types/next-auth.d.ts`を作成:

```typescript
import 'next-auth';

declare module 'next-auth' {
  interface Session {
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
  }
}
```

### Phase 3: Google Calendar API統合（4-8時間）

#### 3.1 APIクライアント作成
`lib/googleCalendar.ts`:

```typescript
import { google } from 'googleapis';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';

export async function getCalendarClient() {
  const session = await getServerSession(authOptions);
  
  if (!session?.accessToken) {
    throw new Error('Not authenticated');
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: session.accessToken,
  });

  return google.calendar({ version: 'v3', auth: oauth2Client });
}

export async function getCalendarEvents(
  startDate: Date,
  endDate: Date,
  maxResults: number = 100
) {
  const calendar = await getCalendarClient();
  
  const response = await calendar.events.list({
    calendarId: 'primary',
    timeMin: startDate.toISOString(),
    timeMax: endDate.toISOString(),
    maxResults,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return response.data.items || [];
}
```

#### 3.2 APIルート作成
`app/api/calendar/events/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getCalendarEvents } from '@/lib/googleCalendar';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const startDate = new Date(searchParams.get('startDate') || new Date());
    const endDate = new Date(searchParams.get('endDate') || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

    const events = await getCalendarEvents(startDate, endDate);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Calendar API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch calendar events' },
      { status: 500 }
    );
  }
}
```

### Phase 4: UI統合（4-6時間）

#### 4.1 型定義
`types/calendar.ts`:

```typescript
export type GoogleCalendarEvent = {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
  htmlLink: string;
};
```

#### 4.2 カスタムフック作成
`hooks/useGoogleCalendar.ts`:

```typescript
import { useState, useEffect } from 'react';
import { GoogleCalendarEvent } from '@/types/calendar';

export function useGoogleCalendar(startDate: Date, endDate: Date) {
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEvents() {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });

        const response = await fetch(`/api/calendar/events?${params}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch events');
        }

        const data = await response.json();
        setEvents(data.events);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchEvents();
  }, [startDate, endDate]);

  return { events, loading, error };
}
```

#### 4.3 TimelineViewへの統合
既存の`TimelineBoardPage.tsx`に統合:

```typescript
import { useGoogleCalendar } from '@/hooks/useGoogleCalendar';

// コンポーネント内
const { events: calendarEvents, loading: calendarLoading } = useGoogleCalendar(
  visibleDays[0]?.date || new Date(),
  visibleDays[visibleDays.length - 1]?.date || new Date()
);
```

#### 4.4 カレンダーイベント表示コンポーネント
`components/CalendarEventCard.tsx`:

```typescript
import { GoogleCalendarEvent } from '@/types/calendar';

type CalendarEventCardProps = {
  event: GoogleCalendarEvent;
};

export function CalendarEventCard({ event }: CalendarEventCardProps) {
  const startTime = event.start.dateTime 
    ? new Date(event.start.dateTime).toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : '終日';

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 opacity-75">
      <div className="flex items-start gap-2">
        <div className="text-xs text-blue-600 font-medium">
          {startTime}
        </div>
        <div className="flex-1">
          <div className="font-medium text-sm text-blue-900">
            {event.summary}
          </div>
          {event.location && (
            <div className="text-xs text-blue-600 mt-1">
              📍 {event.location}
            </div>
          )}
        </div>
        <a
          href={event.htmlLink}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:text-blue-700"
          title="Googleカレンダーで開く"
        >
          🔗
        </a>
      </div>
    </div>
  );
}
```

### Phase 5: 書き込み機能（オプション、4-6時間）

#### 5.1 イベント作成関数
`lib/googleCalendar.ts`に追加:

```typescript
export async function createCalendarEvent(
  title: string,
  startDateTime: Date,
  endDateTime: Date,
  description?: string,
  location?: string
) {
  const calendar = await getCalendarClient();
  
  const event = {
    summary: title,
    description,
    location,
    start: {
      dateTime: startDateTime.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
    end: {
      dateTime: endDateTime.toISOString(),
      timeZone: 'Asia/Tokyo',
    },
  };

  const response = await calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
  });

  return response.data;
}

export async function updateCalendarEvent(
  eventId: string,
  updates: {
    title?: string;
    startDateTime?: Date;
    endDateTime?: Date;
    description?: string;
  }
) {
  const calendar = await getCalendarClient();
  
  // 既存イベント取得
  const existingEvent = await calendar.events.get({
    calendarId: 'primary',
    eventId,
  });

  const event = {
    ...existingEvent.data,
    summary: updates.title || existingEvent.data.summary,
    description: updates.description || existingEvent.data.description,
    start: updates.startDateTime 
      ? { dateTime: updates.startDateTime.toISOString(), timeZone: 'Asia/Tokyo' }
      : existingEvent.data.start,
    end: updates.endDateTime
      ? { dateTime: updates.endDateTime.toISOString(), timeZone: 'Asia/Tokyo' }
      : existingEvent.data.end,
  };

  const response = await calendar.events.update({
    calendarId: 'primary',
    eventId,
    requestBody: event,
  });

  return response.data;
}

export async function deleteCalendarEvent(eventId: string) {
  const calendar = await getCalendarClient();
  
  await calendar.events.delete({
    calendarId: 'primary',
    eventId,
  });
}
```

#### 5.2 APIルート（書き込み）
`app/api/calendar/events/route.ts`にPOST/PUT/DELETEメソッド追加:

```typescript
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { title, startDateTime, endDateTime, description, location } = body;

    const event = await createCalendarEvent(
      title,
      new Date(startDateTime),
      new Date(endDateTime),
      description,
      location
    );

    return NextResponse.json({ event });
  } catch (error) {
    console.error('Calendar API error:', error);
    return NextResponse.json(
      { error: 'Failed to create calendar event' },
      { status: 500 }
    );
  }
}
```

## データベース拡張（必要に応じて）

### カレンダー同期テーブル
Taeskタスクとカレンダーイベントを紐付けるテーブル:

```sql
CREATE TABLE calendar_sync (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  google_event_id TEXT NOT NULL,
  calendar_id TEXT DEFAULT 'primary',
  last_synced_at TIMESTAMPTZ DEFAULT NOW(),
  sync_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(card_id, google_event_id)
);
```

## 実装の優先順位

### 推奨フェーズ別実装
1. **最優先（MVP）**: Phase 1-4（読み取り専用）
   - 予定時間: 約2-3日
   - ユーザーメリット: カレンダー予定をタイムラインで確認可能

2. **次のステップ**: Phase 5（書き込み）
   - 予定時間: 約1-2日
   - ユーザーメリット: Taeskからカレンダーに予定追加

3. **将来的**: 双方向同期
   - 予定時間: 約3-5日
   - ユーザーメリット: 完全な同期

## 注意点・制約

### セキュリティ
- [ ] アクセストークンの安全な保管（データベース暗号化）
- [ ] リフレッシュトークンの適切な管理
- [ ] スコープは最小限に（必要な権限のみ）

### API制限
- Google Calendar APIの利用制限:
  - 1ユーザーあたり: 1日100万クエリ
  - 通常の使用では問題なし

### UX考慮事項
- [ ] カレンダーイベントとTaeskタスクの視覚的区別
- [ ] 読み取り専用イベントの編集防止
- [ ] 同期ステータスのフィードバック
- [ ] エラーハンドリングとユーザー通知

## テスト計画

### 機能テスト
- [ ] 認証フロー
- [ ] イベント取得
- [ ] イベント作成
- [ ] イベント更新
- [ ] イベント削除
- [ ] エラーハンドリング

### UI/UXテスト
- [ ] デスクトップビューでの表示
- [ ] モバイルビューでの表示
- [ ] ローディング状態
- [ ] エラー状態

## 参考リンク

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [NextAuth.js Documentation](https://next-auth.js.org/)
- [googleapis Node.js Client](https://github.com/googleapis/google-api-nodejs-client)

## 次のアクション

実装を進める際は、以下の順序で進めることを推奨:

1. ✅ この調査ドキュメントの確認
2. ⬜ Phase 1: 環境セットアップ開始
3. ⬜ Phase 2: 認証実装・テスト
4. ⬜ Phase 3: 読み取り機能実装
5. ⬜ Phase 4: UI統合
6. ⬜ 動作確認・デバッグ
7. ⬜ (オプション) Phase 5: 書き込み機能

---

**作成日**: 2025-12-04  
**ステータス**: 調査完了・実装待ち
