/**
 * Simple request limiter for the expensive or abusable endpoints (AI chat costs money per message, image
 * generation costs CPU, name lookups can be used to enumerate users…).
 *
 * It is a sliding window kept in memory, so it is PER SERVER INSTANCE: on serverless several instances may
 * each allow their own quota. That still stops the common cases (one script hammering an endpoint, a stuck
 * client retry-looping) cheaply; it is not a substitute for the platform firewall against a distributed
 * attack. The database's own uniqueness rules remain the real correctness guards.
 */

export interface LimitRule {
  /** Requests allowed per window. */
  max: number;
  windowMs: number;
}

export interface LimitResult {
  ok: boolean;
  /** Seconds until the oldest counted request ages out (only meaningful when !ok). */
  retryAfterSec: number;
}

const MAX_KEYS = 10_000;

export function createLimiter(rule: LimitRule, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return {
    check(key: string): LimitResult {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < rule.windowMs);
      if (recent.length >= rule.max) {
        hits.set(key, recent);
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil((rule.windowMs - (t - recent[0])) / 1000)) };
      }
      recent.push(t);
      hits.set(key, recent);
      if (hits.size > MAX_KEYS) {
        // Crude eviction so the map can't grow without bound: drop keys with nothing recent.
        for (const [k, v] of hits) if (v.every((x) => t - x >= rule.windowMs)) hits.delete(k);
        if (hits.size > MAX_KEYS) hits.clear();
      }
      return { ok: true, retryAfterSec: 0 };
    },
  };
}

/** Best-effort caller IP. On Vercel the platform sets x-forwarded-for, so the first entry is the client. */
export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  return fwd?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
}

const limiters = new Map<string, ReturnType<typeof createLimiter>>();

/**
 * Check `key` against a named rule; returns a 429 Response when over the limit, or null to carry on.
 * Usage: `const tooMany = rateLimit('agent-chat', userId, { max: 30, windowMs: 60_000 }); if (tooMany) return tooMany;`
 */
export function rateLimit(name: string, key: string, rule: LimitRule): Response | null {
  let limiter = limiters.get(name);
  if (!limiter) {
    limiter = createLimiter(rule);
    limiters.set(name, limiter);
  }
  const res = limiter.check(key);
  if (res.ok) return null;
  return Response.json(
    { error: 'rate_limited', message: 'You’re doing that a bit too fast. Please wait a moment and try again.' },
    { status: 429, headers: { 'retry-after': String(res.retryAfterSec) } },
  );
}
