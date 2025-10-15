# Deployment Guide

## Overview

Taesk is deployed on **Vercel** with **Supabase** as the database backend.

## Prerequisites

1. GitHub account with repository
2. Vercel account (free tier)
3. Supabase project
4. Environment variables

## Vercel Deployment

### Initial Setup

1. **Connect Repository**
   - Go to [vercel.com](https://vercel.com)
   - Click "Import Project"
   - Select GitHub repository: `my151ae/taesk`

2. **Configure Build Settings**
   ```
   Framework Preset: Next.js
   Build Command: npm run build
   Output Directory: .next
   Install Command: npm install
   ```

3. **Set Environment Variables**
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
   ```

   Apply to: Production, Preview, Development

4. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - App live at: `https://taesk.vercel.app`

### Auto-Deploy on Push

Every push to `main` branch triggers automatic deployment.

```
git push origin main
  ↓
GitHub webhook
  ↓
Vercel CI/CD
  ↓
Build & Deploy
  ↓
Live at taesk.vercel.app
```

### Build Process

```bash
# Vercel runs these commands
npm install
npm run build  # next build
# Vercel deploys .next/ directory
```

### Environment Variables

**Production**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

**Note**: `NEXT_PUBLIC_` prefix makes variables available to client-side code.

## Supabase Setup

### Project Creation

1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Note your project URL and anon key

### Database Migrations

Apply migrations via MCP or Supabase CLI:

```typescript
// Via MCP (from Claude Code)
await mcp.supabase.apply_migration({
  name: 'create_lists_and_cards_tables',
  query: `...`
});
```

```bash
# Via Supabase CLI
supabase migration new create_lists_and_cards_tables
# Edit SQL file
supabase db push
```

### RLS Policies

Current (shared board model):
```sql
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage all boards"
  ON public.boards FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage all lists"
  ON public.lists FOR ALL
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can manage all cards"
  ON public.cards FOR ALL
  USING (auth.role() = 'authenticated');
```

Future (per-board permissions):
```sql
CREATE POLICY "Users manage cards of boards they are a member of"
  ON public.cards FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public.board_members
    WHERE board_members.board_id = cards.board_id
      AND board_members.user_id = auth.uid()
  ));
```

## Custom Domain (Optional)

1. Go to Vercel project settings
2. Add custom domain
3. Update DNS records
4. SSL certificate auto-generated

## Monitoring

### Vercel Analytics

- Page views
- Web Vitals
- Error tracking

Enable in Vercel dashboard.

### Supabase Monitoring

- Database metrics
- Query performance
- Storage usage

Available in Supabase dashboard.

## Troubleshooting

### Build Fails

**Error**: `supabaseUrl is required`

**Solution**: Check environment variables are set in Vercel.

### 404 on Reload

**Cause**: SPA routing issue

**Solution**: Vercel auto-handles with Next.js routing.

### Slow Initial Load

**Solution**: Enable edge runtime
```typescript
export const runtime = 'edge';
```

## Performance Optimization

### Next.js Config

```typescript
// next.config.ts
const nextConfig = {
  reactStrictMode: true,
  compress: true,
  poweredByHeader: false,
};
```

### Image Optimization

Use `next/image` for all images:
```tsx
import Image from 'next/image';
<Image src="/icon.png" width={192} height={192} alt="Icon" />
```

### Code Splitting

Next.js auto-splits code. For manual:
```typescript
const DynamicComponent = dynamic(() => import('./HeavyComponent'));
```

## Security

### Environment Variables

- Never commit `.env.local`
- Use Vercel secrets for sensitive data
- Rotate keys regularly

### Headers

```typescript
// next.config.ts
headers: async () => [{
  source: '/:path*',
  headers: [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'origin-when-cross-origin' },
  ],
}],
```

## Rollback

### Vercel

1. Go to Deployments
2. Find previous deployment
3. Click "Promote to Production"

### Supabase

```bash
# Revert migration
supabase migration revert
```

## CI/CD Pipeline

```
┌──────────┐
│  GitHub  │
└────┬─────┘
     │ Push to main
     ▼
┌──────────────┐
│ Vercel Build │
│              │
│ 1. Install   │
│ 2. Build     │
│ 3. Test      │
│ 4. Deploy    │
└──────┬───────┘
       │ Success
       ▼
┌───────────────┐
│  Production   │
│ taesk.vercel  │
│     .app      │
└───────────────┘
```

## Cost Estimation

**Free Tier**:
- Vercel: 100GB bandwidth, unlimited sites
- Supabase: 500MB database, 1GB file storage

**Paid** (if needed):
- Vercel Pro: $20/month (more bandwidth)
- Supabase Pro: $25/month (8GB database)
