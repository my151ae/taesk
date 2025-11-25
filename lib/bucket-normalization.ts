import { DueBucket } from "@/lib/supabase";

export function normalizeDueBucket(bucket: string | null | undefined): DueBucket | null {
  if (!bucket) return null;
  if (bucket === "a" || bucket === "b") return bucket;
  throw new Error(`[bucket-normalization] Unsupported due_bucket: ${bucket}`);
}

export function bucketKeyToDueBucket(bucketKey: string): DueBucket {
  const suffix = bucketKey.split("_").pop();
  if (suffix === "a" || suffix === "b") return suffix;
  throw new Error(`[bucket-normalization] Invalid bucket key: ${bucketKey}`);
}
