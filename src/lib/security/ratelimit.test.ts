import { describe, expect, it } from 'vitest';
import { clientIp, createLimiter, rateLimit } from './ratelimit';

describe('createLimiter', () => {
  it('allows up to max in a window, then blocks, then recovers as the window slides', () => {
    let t = 1_000_000;
    const l = createLimiter({ max: 3, windowMs: 10_000 }, () => t);
    expect(l.check('a').ok).toBe(true);
    expect(l.check('a').ok).toBe(true);
    expect(l.check('a').ok).toBe(true);
    const blocked = l.check('a');
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(10);
    t += 4_000;
    expect(l.check('a').retryAfterSec).toBe(6); // oldest hit ages out in 6s
    t += 6_001;
    expect(l.check('a').ok).toBe(true);
  });

  it('keeps callers separate', () => {
    const l = createLimiter({ max: 1, windowMs: 60_000 });
    expect(l.check('alice').ok).toBe(true);
    expect(l.check('alice').ok).toBe(false);
    expect(l.check('bob').ok).toBe(true);
  });

  it('a blocked request does not extend the block', () => {
    let t = 0;
    const l = createLimiter({ max: 1, windowMs: 1_000 }, () => t);
    expect(l.check('k').ok).toBe(true);
    for (let i = 0; i < 20; i++) {
      t += 10;
      expect(l.check('k').ok).toBe(false);
    }
    t = 1_001;
    expect(l.check('k').ok).toBe(true);
  });
});

describe('rateLimit', () => {
  it('returns null until the limit, then a 429 with Retry-After', async () => {
    const rule = { max: 2, windowMs: 60_000 };
    expect(rateLimit('t-rule', 'u1', rule)).toBeNull();
    expect(rateLimit('t-rule', 'u1', rule)).toBeNull();
    const res = rateLimit('t-rule', 'u1', rule);
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(((await res!.json()) as { error: string }).error).toBe('rate_limited');
  });
});

describe('clientIp', () => {
  it('uses the first forwarded address, then x-real-ip, else unknown', () => {
    expect(clientIp(new Request('https://x.test', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }))).toBe('1.2.3.4');
    expect(clientIp(new Request('https://x.test', { headers: { 'x-real-ip': '5.6.7.8' } }))).toBe('5.6.7.8');
    expect(clientIp(new Request('https://x.test'))).toBe('unknown');
  });
});
