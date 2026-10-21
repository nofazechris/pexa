import 'server-only';
import { buildYieldView, type YieldView } from './view';
import type { RawPool, YieldQuery } from './rank';
import { toRawPools } from './parse';

/**
 * Reads DefiLlama's public yield index (free, no key) and keeps it for ten minutes. Fails soft: if the source is down the person
 * is told so, never shown stale numbers as if they were fresh.
 */
const SOURCE = 'https://yields.llama.fi/pools';
const TTL_MS = 10 * 60_000;
const MAX_STALE_MS = 60 * 60_000;

let cache: { at: number; pools: RawPool[] } | null = null;

async function loadPools(): Promise<{ at: number; pools: RawPool[] } | null> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const res = await fetch(SOURCE, { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const pools = toRawPools(await res.json());
    if (!pools.length) throw new Error('empty');
    cache = { at: now, pools };
    return cache;
  } catch (e) {
    console.error('[yield] source unavailable:', e instanceof Error ? e.message : e);
    return cache && now - cache.at < MAX_STALE_MS ? cache : null;
  }
}

/** The ranked shortlist for a request, or null when the data source can't be read. */
export async function researchYields(q: YieldQuery): Promise<YieldView | null> {
  const loaded = await loadPools();
  return loaded ? buildYieldView(loaded.pools, q, new Date(loaded.at)) : null;
}

/** The temporary incentive rewards on Aave's Celo market for a coin, from the public data (null when unknown). */
export async function aaveCeloRewards(token: 'USDT' | 'USDC'): Promise<{ apyBase: number; apyReward: number } | null> {
  const loaded = await loadPools();
  if (!loaded) return null;
  const symbols = token === 'USDT' ? ['USD₮', 'USDT'] : ['USDC'];
  const p = loaded.pools.filter((x) => x.chain === 'Celo' && x.project === 'aave-v3' && symbols.includes(x.symbol)).sort((a, b) => b.tvlUsd - a.tvlUsd)[0];
  return p ? { apyBase: p.apyBase ?? 0, apyReward: p.apyReward ?? 0 } : null;
}

/** Every pool in the data (cached ten minutes), or null when the source can't be read. */
export async function getRawPools(): Promise<RawPool[] | null> {
  const loaded = await loadPools();
  return loaded ? loaded.pools : null;
}
