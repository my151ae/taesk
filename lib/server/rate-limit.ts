interface RateLimitBucket {
  count: number;
  expiresAt: number;
}

const buckets = new Map<string, RateLimitBucket>();

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit({
  key,
  limit,
  windowMs,
}: {
  key: string;
  limit: number;
  windowMs: number;
}): RateLimitResult {
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
