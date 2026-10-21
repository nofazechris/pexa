import 'server-only';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { getRawPools } from './service';
import { findPool } from './find';
import { assess, type RawPool, type RiskLevel } from './rank';
import { detectChanges, MAX_WATCHES, sinceText, withoutRecent, type Snapshot } from './watch';

/**
 * Watching pools: save what a pool looked like, look again later (on every cron tick and whenever the person opens their
 * notifications), and write an alert when something that matters changed. Only public pool facts are stored.
 */

const RECHECK_MS = 25 * 60_000;

export interface WatchView {
  id: string;
  poolId: string;
  symbol: string;
  project: string;
  chain: string;
  url: string;
  /** Set when Pexa can deposit into this pool for the person. */
  depositToken: 'USDT' | 'USDC' | null;
  risk: RiskLevel | null;
  targetApy: number | null;
  /** Null when the pool is no longer in the data. */
  now: Snapshot | null;
  baseline: Snapshot;
  /** Plain-words change since it was added. */
  since: string;
  addedAt: string;
}

const snap = (p: RawPool): Snapshot => ({ apyBase: p.apyBase ?? 0, apyReward: p.apyReward ?? 0, tvlUsd: p.tvlUsd });
const labelOf = (r: { symbol: string; project: string; chain: string }) => `${r.symbol} on ${r.project} (${r.chain})`;

export type AddResult = { ok: true; watch: WatchView; alreadyWatching: boolean; others: number } | { ok: false; message: string };

export async function addWatch(userId: string, ref: { poolId?: string; chain?: string; project?: string; symbol?: string }, targetApy?: number | null): Promise<AddResult> {
  const pools = await getRawPools();
  if (!pools) return { ok: false, message: 'The yield data source didn’t answer just now. Try again in a minute.' };
  const hit = findPool(pools, ref);
  if (!hit) return { ok: false, message: 'I couldn’t find that pool in the data. Ask me to research yields first, then tap Watch on one of the results.' };
  const db = getDb();
  const existing = await db.select().from(schema.yieldWatches).where(and(eq(schema.yieldWatches.userId, userId), eq(schema.yieldWatches.active, true)));
  const already = existing.find((w) => w.poolId === hit.pool.pool);
  if (!already && existing.length >= MAX_WATCHES) return { ok: false, message: `You’re watching ${MAX_WATCHES} pools, which is the most for now. Stop watching one first.` };

  const s = snap(hit.pool);
  const target = typeof targetApy === 'number' && targetApy > 0 && targetApy <= 100 ? targetApy : null;
  await db
    .insert(schema.yieldWatches)
    .values({ userId, poolId: hit.pool.pool, chain: hit.pool.chain, project: hit.pool.project, symbol: hit.pool.symbol, targetApy: target, baselineApyBase: s.apyBase, baselineApyReward: s.apyReward, baselineTvl: s.tvlUsd, lastApyBase: s.apyBase, lastApyReward: s.apyReward, lastTvl: s.tvlUsd, active: true, lastCheckedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.yieldWatches.userId, schema.yieldWatches.poolId], set: { active: true, ...(target !== null ? { targetApy: target } : {}) } });
  const views = await listWatches(userId);
  const watch = views.find((w) => w.poolId === hit.pool.pool);
  if (!watch) return { ok: false, message: 'I couldn’t save that just now. Try again.' };
  return { ok: true, watch, alreadyWatching: Boolean(already), others: hit.others };
}

export async function listWatches(userId: string): Promise<WatchView[]> {
  const rows = await getDb()
    .select()
    .from(schema.yieldWatches)
    .where(and(eq(schema.yieldWatches.userId, userId), eq(schema.yieldWatches.active, true)))
    .orderBy(desc(schema.yieldWatches.createdAt));
  if (!rows.length) return [];
  const pools = (await getRawPools()) ?? [];
  const byId = new Map(pools.map((p) => [p.pool, p]));
  return rows.map((r) => {
    const raw = byId.get(r.poolId);
    const a = raw ? assess(raw) : null;
    const baseline: Snapshot = { apyBase: r.baselineApyBase, apyReward: r.baselineApyReward, tvlUsd: r.baselineTvl };
    const now = raw ? snap(raw) : null;
    return {
      id: r.id,
      poolId: r.poolId,
      symbol: r.symbol,
      project: r.project,
      chain: r.chain,
      url: a?.url ?? `https://defillama.com/yields/pool/${encodeURIComponent(r.poolId)}`,
      depositToken: a?.depositToken ?? null,
      risk: a?.risk ?? null,
      targetApy: r.targetApy,
      now,
      baseline,
      since: sinceText(baseline, now),
      addedAt: r.createdAt.toISOString(),
    };
  });
}

/** Stop watching one pool, by watch id or by describing it ("USDT on Celo"). */
export async function removeWatch(userId: string, ref: { id?: string; chain?: string; project?: string; symbol?: string }): Promise<{ ok: boolean; message: string }> {
  const db = getDb();
  const mine = await db.select().from(schema.yieldWatches).where(and(eq(schema.yieldWatches.userId, userId), eq(schema.yieldWatches.active, true)));
  const hits = ref.id
    ? mine.filter((w) => w.id === ref.id)
    : mine.filter((w) => (!ref.chain || w.chain.toLowerCase() === ref.chain.toLowerCase()) && (!ref.project || w.project.toLowerCase().includes(ref.project.toLowerCase())) && (!ref.symbol || w.symbol.toLowerCase().replace(/₮/g, 't').includes(ref.symbol.toLowerCase().replace(/₮/g, 't'))));
  if (!hits.length) return { ok: false, message: 'I’m not watching a pool like that.' };
  if (hits.length > 1 && !ref.id) return { ok: false, message: `That matches ${hits.length} of your pools: ${hits.map((h) => labelOf(h)).join('; ')}. Tell me which one.` };
  await db.update(schema.yieldWatches).set({ active: false }).where(eq(schema.yieldWatches.id, hits[0].id));
  return { ok: true, message: `Stopped watching ${labelOf(hits[0])}.` };
}

/**
 * Look again at the watched pools (one person's, or everyone's on the cron tick), write an alert for anything that changed, and
 * move the reference forward so the same change isn't told twice. A watch looked at in the last 25 minutes is skipped unless
 * `force`. Fails soft: if the data source can't be read nothing changes.
 */
export async function checkWatches(opts: { userId?: string; force?: boolean } = {}): Promise<{ watched: number; alerts: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.yieldWatches)
    .where(opts.userId ? and(eq(schema.yieldWatches.active, true), eq(schema.yieldWatches.userId, opts.userId)) : eq(schema.yieldWatches.active, true));
  const cutoff = Date.now() - RECHECK_MS;
  const due = rows.filter((r) => opts.force || !r.lastCheckedAt || r.lastCheckedAt.getTime() < cutoff);
  if (!due.length) return { watched: 0, alerts: 0 };
  const pools = await getRawPools();
  if (!pools) return { watched: 0, alerts: 0 };
  const byId = new Map(pools.map((p) => [p.pool, p]));

  const now = new Date();
  const recent = await db
    .select({ watchId: schema.watchAlerts.watchId, kind: schema.watchAlerts.kind, at: schema.watchAlerts.createdAt })
    .from(schema.watchAlerts)
    .where(and(inArray(schema.watchAlerts.watchId, due.map((r) => r.id)), gt(schema.watchAlerts.createdAt, new Date(now.getTime() - 24 * 3600_000))));

  let alerts = 0;
  for (const r of due) {
    const raw = byId.get(r.poolId);
    const current = raw ? snap(raw) : null;
    const ref: Snapshot = { apyBase: r.lastApyBase, apyReward: r.lastApyReward, tvlUsd: r.lastTvl };
    const found = withoutRecent(detectChanges(ref, current, { label: labelOf(r), targetApy: r.targetApy }), recent.filter((x) => x.watchId === r.id), now);
    if (found.length) {
      await db.insert(schema.watchAlerts).values(found.map((a) => ({ userId: r.userId, watchId: r.id, kind: a.kind, title: a.title, detail: a.detail })));
      alerts += found.length;
    }
    await db
      .update(schema.yieldWatches)
      .set({ lastCheckedAt: now, ...(found.length && current ? { lastApyBase: current.apyBase, lastApyReward: current.apyReward, lastTvl: current.tvlUsd } : {}), ...(current === null && found.length ? { active: false } : {}) })
      .where(eq(schema.yieldWatches.id, r.id));
  }
  return { watched: due.length, alerts };
}

/** A person's recent alerts, newest first (shown in their notifications). */
export async function watchAlertsFor(userId: string, limit = 30): Promise<{ id: string; title: string; detail: string; at: Date }[]> {
  const rows = await getDb().select().from(schema.watchAlerts).where(eq(schema.watchAlerts.userId, userId)).orderBy(desc(schema.watchAlerts.createdAt)).limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.title, detail: r.detail, at: r.createdAt }));
}

/** The cron tick: look at every watched pool. */
export async function runWatchChecks(): Promise<{ watched: number; alerts: number }> {
  return checkWatches({ force: true });
}
