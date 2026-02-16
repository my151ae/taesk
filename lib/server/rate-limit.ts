interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

const buckets = new Map<string, RateLimitBucket>();
const KV_ENABLED = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

async function checkRateLimitLocal({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.expiresAt <= now) {
    const expiresAt = now + windowMs;
    buckets.set(key, { count: 1, expiresAt });
    return {
      ok: true,
      remaining: Math.max(limit - 1, 0),
      resetAt: expiresAt,
    };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      resetAt: bucket.expiresAt,
    };
  }

  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    ok: true,
    remaining: Math.max(limit - bucket.count, 0),
    resetAt: bucket.expiresAt,
  };
}

export async function checkRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  if (KV_ENABLED) {
    try {
      const { kv } = await import('@vercel/kv');
      const now = Date.now();
      const windowSlot = Math.floor(now / windowMs);
      const resetAt = (windowSlot + 1) * windowMs;
      const kvKey = `rate-limit:${key}:${windowSlot}`;
      const currentCount = await kv.incr(kvKey);

      if (currentCount === 1) {
        const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000) + 1);
        await kv.expire(kvKey, ttlSeconds);
      }

      return {
        ok: currentCount <= limit,
        remaining: Math.max(limit - currentCount, 0),
        resetAt,
      };
    } catch (error) {
      console.warn('[rate-limit] KV unavailable, falling back to local bucket:', error);
    }
  }

  return checkRateLimitLocal({ key, limit, windowMs });
}

// Backward-compatible sync-like name for existing callers migrating to async.
export async function checkRateLimitWithFallback(args: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<RateLimitResult> {
  return checkRateLimit(args);
}
