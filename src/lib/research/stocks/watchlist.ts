import 'server-only';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { lookupPrice, lookupPrices } from './prices-service';
import { MAX_TICKER_WATCHES, detectPriceMoves, priceSince, talkSince, tractionChange, withoutRecent, type Traction, type TickerAlert } from './watch';

/**
 * Watching stocks. The price is free to look at, so it is checked whenever the person opens the app and once a day, and a big move
 * since the last message becomes an alert. The talk costs a few cents through Buy, so it is refreshed only when the person asks
 * (a button that plans a tiny approved search) — and then compared with last time. Only public facts are stored.
 */

const RECHECK_MS = 25 * 60_000;

export interface TickerWatchView {
  id: string;
  symbol: string;
  name: string | null;
  /** The price now, or null when it couldn't be read. */
  price: number | null;
  /** Plain words: how the price has moved since it was added. */
  priceSince: string;
  /** Plain words: how the talk compares with when it was added (or that it hasn't been refreshed). */
  talk: string;
  /** When the talk was last refreshed (ISO), or null. */
  tractionAt: string | null;
  url: string;
  addedAt: string;
}

export type AddTickerResult = { ok: true; watch: TickerWatchView; alreadyWatching: boolean } | { ok: false; message: string };

const clampInt = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100_000, Math.round(n))) : 0);

export async function addTickerWatch(userId: string, symbol: string, baseline: { authors?: number; posts?: number } = {}): Promise<AddTickerResult> {
  const sym = symbol.trim().replace(/^\$/, '').toUpperCase();
  if (!/^[A-Z]{1,5}$/.test(sym)) return { ok: false, message: 'That doesn’t look like a stock symbol — give me one like NVDA or AAPL.' };
  const found = await lookupPrice(sym);
  if (found.status === 'unknown') return { ok: false, message: `I couldn’t find a stock with the symbol ${sym}, so there’s nothing to watch.` };
  if (found.status === 'error') return { ok: false, message: 'The price source didn’t answer just now. Try again in a minute.' };
  const db = getDb();
  const existing = await db.select().from(schema.tickerWatches).where(and(eq(schema.tickerWatches.userId, userId), eq(schema.tickerWatches.active, true)));
  const already = existing.find((w) => w.symbol === sym);
  if (!already && existing.length >= MAX_TICKER_WATCHES) return { ok: false, message: `You’re watching ${MAX_TICKER_WATCHES} stocks, which is the most for now. Stop watching one first.` };
  const authors = clampInt(baseline.authors);
  const posts = clampInt(baseline.posts);
  await db
    .insert(schema.tickerWatches)
    .values({ userId, symbol: sym, name: found.stats.name, baselineAuthors: authors, baselinePosts: posts, baselinePrice: found.stats.last, lastAuthors: authors, lastPosts: posts, refPrice: found.stats.last, active: true, lastCheckedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.tickerWatches.userId, schema.tickerWatches.symbol], set: { active: true } });
  const watch = (await listTickerWatches(userId)).find((w) => w.symbol === sym);
  if (!watch) return { ok: false, message: 'I couldn’t save that just now. Try again.' };
  return { ok: true, watch, alreadyWatching: Boolean(already) };
}

export async function listTickerWatches(userId: string): Promise<TickerWatchView[]> {
  const rows = await getDb()
    .select()
    .from(schema.tickerWatches)
    .where(and(eq(schema.tickerWatches.userId, userId), eq(schema.tickerWatches.active, true)))
    .orderBy(desc(schema.tickerWatches.createdAt));
  if (!rows.length) return [];
  const prices = await lookupPrices(rows.map((r) => r.symbol));
  return rows.map((r) => {
    const p = prices.get(r.symbol);
    const now = p?.status === 'ok' ? p.stats.last : null;
    return {
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      price: now,
      priceSince: priceSince(r.baselinePrice, now),
      talk: talkSince({ authors: r.baselineAuthors, posts: r.baselinePosts }, r.tractionAt ? { authors: r.lastAuthors, posts: r.lastPosts } : null),
      tractionAt: r.tractionAt ? r.tractionAt.toISOString() : null,
      url: `https://finance.yahoo.com/quote/${encodeURIComponent(r.symbol)}`,
      addedAt: r.createdAt.toISOString(),
    };
  });
}

/** Stop watching one stock, by watch id or by symbol. */
export async function removeTickerWatch(userId: string, ref: { id?: string; symbol?: string }): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const sym = ref.symbol?.replace(/^\$/, '').toUpperCase();
  const mine = await db.select().from(schema.tickerWatches).where(and(eq(schema.tickerWatches.userId, userId), eq(schema.tickerWatches.active, true)));
  const hit = ref.id ? mine.find((w) => w.id === ref.id) : mine.find((w) => w.symbol === sym);
  if (!hit) return { ok: false, message: 'I’m not watching a stock like that.' };
  await db.update(schema.tickerWatches).set({ active: false }).where(eq(schema.tickerWatches.id, hit.id));
  return { ok: true, message: `Stopped watching $${hit.symbol}.` };
}

/** Is this stock on the person's watchlist? */
export async function isWatchingTicker(userId: string, symbol: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: schema.tickerWatches.id })
    .from(schema.tickerWatches)
    .where(and(eq(schema.tickerWatches.userId, userId), eq(schema.tickerWatches.symbol, symbol.toUpperCase()), eq(schema.tickerWatches.active, true)))
    .limit(1);
  return Boolean(row);
}

/**
 * Look again at the watched stocks' prices (one person's, or everyone's on the cron tick) and write an alert for a big move since
 * the last one. A stock looked at in the last 25 minutes is skipped unless `force`. Fails soft.
 */
export async function checkTickerWatches(opts: { userId?: string; force?: boolean } = {}): Promise<{ watched: number; alerts: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.tickerWatches)
    .where(opts.userId ? and(eq(schema.tickerWatches.active, true), eq(schema.tickerWatches.userId, opts.userId)) : eq(schema.tickerWatches.active, true));
  const cutoff = Date.now() - RECHECK_MS;
  const due = rows.filter((r) => opts.force || !r.lastCheckedAt || r.lastCheckedAt.getTime() < cutoff);
  if (!due.length) return { watched: 0, alerts: 0 };
  const prices = await lookupPrices(due.map((r) => r.symbol));
  const now = new Date();
  const recent = await db
    .select({ watchId: schema.tickerAlerts.watchId, kind: schema.tickerAlerts.kind, at: schema.tickerAlerts.createdAt })
    .from(schema.tickerAlerts)
    .where(and(inArray(schema.tickerAlerts.watchId, due.map((r) => r.id)), gt(schema.tickerAlerts.createdAt, new Date(now.getTime() - 24 * 3600_000))));

  let alerts = 0;
  for (const r of due) {
    const p = prices.get(r.symbol);
    if (!p || p.status === 'error') continue; // couldn't read it: change nothing, try later
    const stats = p.status === 'ok' ? p.stats : null;
    const found: TickerAlert[] = withoutRecent(detectPriceMoves(r.symbol, r.refPrice, stats), recent.filter((x) => x.watchId === r.id), now);
    if (found.length) {
      await db.insert(schema.tickerAlerts).values(found.map((a) => ({ userId: r.userId, watchId: r.id, kind: a.kind, title: a.title, detail: a.detail })));
      alerts += found.length;
    }
    await db
      .update(schema.tickerWatches)
      .set({ lastCheckedAt: now, ...(found.length && stats ? { refPrice: stats.last } : {}), ...(stats === null && found.length ? { active: false } : {}) })
      .where(eq(schema.tickerWatches.id, r.id));
  }
  return { watched: due.length, alerts };
}

/**
 * The talk about a watched stock was just refreshed: compare it with last time, remember it, and say whether more or fewer people
 * are talking now. `watched` is false when it isn't on their list (nothing to compare or save).
 */
export async function recordTraction(userId: string, symbol: string, now: Traction): Promise<{ watched: boolean; previous: Traction | null; change: TickerAlert | null }> {
  const db = getDb();
  const sym = symbol.toUpperCase();
  const [row] = await db
    .select()
    .from(schema.tickerWatches)
    .where(and(eq(schema.tickerWatches.userId, userId), eq(schema.tickerWatches.symbol, sym), eq(schema.tickerWatches.active, true)))
    .limit(1);
  if (!row) return { watched: false, previous: null, change: null };
  const previous: Traction = { authors: row.lastAuthors, posts: row.lastPosts };
  const change = tractionChange(sym, previous, now);
  await db.update(schema.tickerWatches).set({ lastAuthors: now.authors, lastPosts: now.posts, tractionAt: new Date() }).where(eq(schema.tickerWatches.id, row.id));
  if (change) await db.insert(schema.tickerAlerts).values({ userId, watchId: row.id, kind: change.kind, title: change.title, detail: change.detail });
  return { watched: true, previous, change };
}

/** A person's recent stock alerts, newest first (shown in their notifications). */
export async function tickerAlertsFor(userId: string, limit = 30): Promise<{ id: string; title: string; detail: string; at: Date }[]> {
  const rows = await getDb().select().from(schema.tickerAlerts).where(eq(schema.tickerAlerts.userId, userId)).orderBy(desc(schema.tickerAlerts.createdAt)).limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, detail: r.detail, at: r.createdAt }));
}

/** The cron tick: look at every watched stock's price. */
export async function runTickerChecks(): Promise<{ watched: number; alerts: number }> {
  return checkTickerWatches({ force: true });
}
