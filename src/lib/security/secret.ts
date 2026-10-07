import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Comparing a secret the caller sends against the one we hold. A plain `===` stops at the first differing
 * character, so response time can leak how much of a guess was right. Hashing both sides first gives equal
 * lengths, and timingSafeEqual then takes the same time whatever the input. An empty secret never matches.
 */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Does this request carry `secret`? Accepts `Authorization: Bearer <secret>` and any extra headers or query
 * parameters the caller allows (e.g. a scheduler that can't set Authorization). With no secret configured the
 * answer is always no, so a missing setting can never open an endpoint.
 */
export function requestHasSecret(req: Request, secret: string | undefined, opts: { headers?: string[]; queryParams?: string[] } = {}): boolean {
  if (!secret) return false;
  const auth = req.headers.get('authorization');
  if (auth && /^bearer\s/i.test(auth) && safeEqual(auth.slice(7).trim(), secret)) return true;
  for (const h of opts.headers ?? []) if (safeEqual(req.headers.get(h), secret)) return true;
  if (opts.queryParams?.length) {
    const url = new URL(req.url);
    for (const q of opts.queryParams) if (safeEqual(url.searchParams.get(q), secret)) return true;
  }
  return false;
}
