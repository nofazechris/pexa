import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb, isDbConfigured } from '@/lib/db';
import { celoClient } from '@/lib/celo/client';
import { env } from '@/lib/config';
import { clientIp, rateLimit } from '@/lib/security/ratelimit';
import { aiBreaker } from '@/lib/agent/resilience';

/**
 * Is Pexa healthy? For an uptime monitor (point UptimeRobot/BetterStack at /api/health): 200 when the database and the
 * Celo connection answer, 503 when either doesn't, so you hear about an outage before your users tell you.
 * Public and cheap; it reveals nothing but yes/no and timings. It does not call the AI provider (that costs money) —
 * it reports whether the AI is set up and whether recent calls to it have been failing.
 */
export const dynamic = 'force-dynamic';

async function check(name: string, fn: () => Promise<unknown>, ms = 6000): Promise<{ ok: boolean; ms: number }> {
  const t = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error(`${name} timed out`)), ms))]);
    return { ok: true, ms: Date.now() - t };
  } catch {
    return { ok: false, ms: Date.now() - t };
  }
}

export async function GET(req: Request) {
  const tooMany = rateLimit('health', clientIp(req), { max: 30, windowMs: 60_000 });
  if (tooMany) return tooMany;

  const [database, celo] = await Promise.all([
    isDbConfigured() ? check('database', () => getDb().execute(sql`select 1`)) : Promise.resolve({ ok: false, ms: 0 }),
    check('celo', () => celoClient().getBlockNumber()),
  ]);
  const ai = { configured: Boolean(env.AI_API_KEY), recentlyFailing: aiBreaker.isOpen(Date.now()) };
  const ok = database.ok && celo.ok;
  return NextResponse.json({ ok, database, celo, ai, time: new Date().toISOString() }, { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } });
}
