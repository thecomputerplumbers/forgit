export type RateDecision = { ok: boolean; remaining: number };

export type RateBucket = { count: number; windowStart: number };

/**
 * Fixed-window counter. Callers persist the returned bucket.
 * Two concurrent requests can both observe the old count; that is acceptable
 * for the first release and is not a lock.
 */
export function takeRate(
  current: RateBucket | null,
  now: number,
  windowMs: number,
  max: number,
): { decision: RateDecision; bucket: RateBucket } {
  const fresh = !current || now - current.windowStart >= windowMs;
  const bucket = fresh
    ? { count: 1, windowStart: now }
    : { count: current.count + 1, windowStart: current.windowStart };
  const ok = bucket.count <= max;
  return {
    decision: { ok, remaining: Math.max(0, max - bucket.count) },
    bucket,
  };
}
