/**
 * Yield research: take public pool data (DefiLlama) and turn it into an honest shortlist. Every number shown is one the data
 * source published; nothing is predicted or invented. The point is to separate what a pool pays steadily (base interest, trading
 * fees) from what is temporary (incentive rewards), and to say plainly what could go wrong — never to call anything safe.
 *
 * Pure.
 */

/** The fields we keep from a DefiLlama pool. */
export interface RawPool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  apyMean30d: number | null;
  stablecoin: boolean;
  ilRisk: string | null;
  exposure: string | null;
  outlier: boolean;
}

export type RiskLevel = 'lower' | 'medium' | 'high';
export type PoolKind = 'lending' | 'liquidity pool' | 'staking' | 'other';

export interface YieldPool {
  id: string;
  chain: string;
  project: string;
  symbol: string;
  kind: PoolKind;
  tvlUsd: number;
  /** Headline APY (base + rewards). */
  apy: number;
  /** What it pays without incentives: lending interest or trading fees. */
  apyBase: number;
  /** Temporary incentive rewards. */
  apyReward: number;
  /** Share of the headline APY that is rewards, 0–1. */
  rewardShare: number;
  /** The 30-day average headline APY, when published. */
  apy30d: number | null;
  stablecoin: boolean;
  risk: RiskLevel;
  /** Plain-words reasons for the risk level. */
  flags: string[];
  url: string;
  /** Set when Pexa can deposit into this pool for the person (Aave v3 on Celo, USDT or USDC). */
  depositToken: 'USDT' | 'USDC' | null;
  /** Rank score: base APY plus 40% of rewards. Shown only through the order. */
  steady: number;
}

export interface YieldQuery {
  /** Chains to include, any case ("celo", "Base"). Empty = every chain. */
  chains?: string[];
  assets?: 'stablecoins' | 'any';
  /** Part of the pool symbol, e.g. "USDC", "ETH". */
  symbol?: string;
  minTvlUsd?: number;
  limit?: number;
  /** Hide pools riskier than this (set from what the person told us about themselves). */
  maxRisk?: RiskLevel;
}

export const DEFAULT_MIN_TVL = 250_000;
export const MAX_LIMIT = 8;

const LENDING = /^(aave|moola|compound|morpho|spark|venus|radiant|fluid|euler|silo)/i;
const POOLS = /^(uniswap|curve|aerodrome|velodrome|sushi|pancake|balancer|mento|ramses|camelot|trader-joe|orca|raydium|meteora)/i;
const STAKING = /(lido|rocket|stcelo|staked|stake|eigen|frax-ether|swell|ether\.fi|jito|marinade|binance-staked)/i;

export function kindOf(project: string): PoolKind {
  if (STAKING.test(project)) return 'staking';
  if (LENDING.test(project)) return 'lending';
  if (POOLS.test(project)) return 'liquidity pool';
  return 'other';
}

/** Dollar and euro stablecoins by name. The data source's own flag misses some (it calls Celo's Aave USD₮ pool "not a stablecoin"). */
const STABLE_PARTS = new Set(['USDC', 'USDT', 'USAT', 'USDM', 'CUSD', 'DAI', 'USDS', 'FDUSD', 'PYUSD', 'USDE', 'GHO', 'LUSD', 'CRVUSD', 'EURC', 'EURM', 'CEUR', 'USDGLO', 'USDX']);

/** Is every coin in this pool a stablecoin? True when the source says so, or when each part of the symbol is a known one. */
export function isStable(p: Pick<RawPool, 'symbol' | 'stablecoin'>): boolean {
  if (p.stablecoin) return true;
  const parts = p.symbol
    .toUpperCase()
    .replace(/₮/g, 'T')
    .split(/[-/\s+]+/)
    .filter(Boolean);
  return parts.length > 0 && parts.every((s) => STABLE_PARTS.has(s));
}

/** The only pools Pexa can put money into: Aave v3 on Celo, for USDT and USDC (USAT is not an Aave market). */
export function depositTokenFor(p: Pick<RawPool, 'chain' | 'project' | 'symbol'>): 'USDT' | 'USDC' | null {
  if (p.chain !== 'Celo' || p.project !== 'aave-v3') return null;
  if (p.symbol === 'USD₮' || p.symbol === 'USDT') return 'USDT';
  return p.symbol === 'USDC' ? 'USDC' : null;
}

const num = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The honest reading of one pool, or null when it has no usable APY. */
export function assess(p: RawPool): YieldPool | null {
  const apy = num(p.apy);
  if (!p.pool || !Number.isFinite(p.tvlUsd) || p.tvlUsd <= 0 || apy < 0) return null;
  const base = num(p.apyBase);
  const reward = num(p.apyReward);
  const known = base + reward;
  const rewardShare = known > 0 ? Math.min(1, reward / known) : 0;
  const mean = p.apyMean30d !== null && Number.isFinite(p.apyMean30d) ? (p.apyMean30d as number) : null;
  const kind = kindOf(p.project);
  const stable = isStable(p);

  const flags: string[] = [];
  let high = false;
  let medium = false;
  if (p.tvlUsd < DEFAULT_MIN_TVL) {
    flags.push('Small pool (under $250K), so one large withdrawal can move it');
    high = true;
  } else if (p.tvlUsd < 1_000_000) {
    flags.push('Fairly small pool (under $1M)');
    medium = true;
  }
  if (rewardShare >= 0.5 && reward > 0) {
    flags.push(`${Math.round(rewardShare * 100)}% of the headline rate is temporary rewards that can end`);
    medium = true;
  }
  if (mean !== null && mean > 0 && apy > mean * 2) {
    flags.push('The rate jumped well above its 30-day average');
    medium = true;
  }
  if (p.ilRisk === 'yes' || p.exposure === 'multi') {
    flags.push('Two assets in one pool: you can lose value if their prices diverge (impermanent loss)');
    medium = true;
  }
  if (!stable) {
    flags.push('Not all stablecoins, so the value of what you hold can fall');
    medium = true;
  }
  if (stable && apy > 25) {
    flags.push('Far above what stablecoins normally pay; that usually means a risk the headline hides');
    high = true;
  } else if (stable && apy > 12) {
    flags.push('High for a stablecoin pool');
    medium = true;
  }
  if (p.outlier) {
    // A statistical flag, not proof of a problem (it also marks big, well-used lending pools), so it asks for care rather than excluding the pool.
    flags.push('The data source marks this rate as a statistical outlier, so treat the number with extra care');
    medium = true;
  }
  if (apy > 40) {
    flags.push('An unusually high rate; high rates usually come with high risk');
    high = true;
  }

  return {
    id: p.pool,
    chain: p.chain,
    project: p.project,
    symbol: p.symbol,
    kind,
    tvlUsd: p.tvlUsd,
    apy,
    apyBase: base,
    apyReward: reward,
    rewardShare,
    apy30d: mean,
    stablecoin: stable,
    risk: high ? 'high' : medium ? 'medium' : 'lower',
    flags,
    url: `https://defillama.com/yields/pool/${encodeURIComponent(p.pool)}`,
    depositToken: depositTokenFor(p),
    steady: base + 0.4 * reward,
  };
}

const RISK_ORDER: Record<RiskLevel, number> = { lower: 0, medium: 1, high: 2 };

/**
 * The best pools for a request. Stablecoin-only by default; small pools are left out unless asked for;
 * ranked by what the pool pays steadily, never by the headline number, with riskier pools after safer ones of a similar rate.
 */
export function rankPools(raw: readonly RawPool[], q: YieldQuery = {}): YieldPool[] {
  const chains = (q.chains ?? []).map((c) => c.trim().toLowerCase()).filter(Boolean);
  const symbol = q.symbol?.trim().toLowerCase();
  const minTvl = q.minTvlUsd ?? DEFAULT_MIN_TVL;
  const limit = Math.max(1, Math.min(MAX_LIMIT, q.limit ?? 5));
  const stableOnly = (q.assets ?? 'stablecoins') === 'stablecoins';

  const out: YieldPool[] = [];
  for (const p of raw) {
    if (chains.length && !chains.includes(p.chain.toLowerCase())) continue;
    if (stableOnly && !isStable(p)) continue;
    if (symbol && !p.symbol.toLowerCase().includes(symbol)) continue;
    if (p.tvlUsd < minTvl) continue;
    const a = assess(p);
    if (a && q.maxRisk && RISK_ORDER[a.risk] > RISK_ORDER[q.maxRisk]) continue;
    if (a && a.steady > 0) out.push(a);
  }
  return out
    .sort((a, b) => b.steady - a.steady || RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || b.tvlUsd - a.tvlUsd)
    .slice(0, limit);
}

/** What the data says about a coin that earns nothing anywhere on a chain — so "no result" can be explained. */
export function coverageNote(raw: readonly RawPool[], chain: string, symbol: string): string | null {
  const here = raw.filter((p) => p.chain.toLowerCase() === chain.toLowerCase() && p.symbol.toLowerCase().includes(symbol.toLowerCase()));
  if (!here.length) return `${symbol.toUpperCase()} has no pools on ${chain} in this data.`;
  const lending = here.filter((p) => kindOf(p.project) === 'lending');
  if (!lending.length) return `${symbol.toUpperCase()} on ${chain} only appears in trading pools, with no lending market.`;
  return null;
}

/** "aave-v3" → "Aave", "moola-market" → "Moola", "aerodrome-slipstream" → "Aerodrome Slipstream": a protocol's name as people write it. */
export function protocolName(project: string): string {
  const base = project
    .replace(/-v\d+(?:\.\d+)?$/i, '')
    .replace(/-(?:market|protocol|finance|dex)$/i, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  return base || project;
}

/**
 * The request behind a pool's "Check what people say" button. It goes through Buy (X and Reddit search, a fraction of a cent
 * each, paid by the person's own wallet after they approve), so the check is the person's own purchase, not something Pexa
 * does on its own.
 */
export function checkText(p: { project: string; chain: string }): string {
  return `Search X and Reddit for recent posts about ${protocolName(p.project)} on ${p.chain}: hacks, exploits, depegs or withdrawal problems`;
}

/** Tidy the model's proposed arguments into a query: strings trimmed and clipped, numbers bounded, anything odd ignored. */
export function queryFrom(args: Record<string, unknown>): YieldQuery {
  const chains = Array.isArray(args.chains) ? args.chains.filter((c): c is string => typeof c === 'string').map((c) => c.trim().slice(0, 30)).filter(Boolean).slice(0, 5) : [];
  const symbol = typeof args.symbol === 'string' ? args.symbol.trim().slice(0, 20) : '';
  const minTvl = typeof args.minTvlUsd === 'number' && Number.isFinite(args.minTvlUsd) ? Math.max(0, Math.min(1e10, args.minTvlUsd)) : undefined;
  const limit = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.round(args.limit) : undefined;
  return { chains, assets: args.assets === 'any' ? 'any' : 'stablecoins', ...(symbol ? { symbol } : {}), ...(minTvl !== undefined ? { minTvlUsd: minTvl } : {}), ...(limit !== undefined ? { limit } : {}) };
}
