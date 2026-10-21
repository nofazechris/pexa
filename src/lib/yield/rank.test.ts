import { describe, expect, it } from 'vitest';
import { assess, coverageNote, kindOf, rankPools, type RawPool } from './rank';

const pool = (over: Partial<RawPool>): RawPool => ({
  pool: 'p1',
  chain: 'Celo',
  project: 'aave-v3',
  symbol: 'USD₮',
  tvlUsd: 1_500_000,
  apy: 6.08,
  apyBase: 0.24,
  apyReward: 5.84,
  apyMean30d: 5.5,
  stablecoin: true,
  ilRisk: 'no',
  exposure: 'single',
  outlier: false,
  ...over,
});

// Shapes taken from real Celo data (2026-10-21).
const REAL: RawPool[] = [
  // The data source really does flag this one as not a stablecoin.
  pool({ pool: 'aave-usdt', chain: 'Celo', project: 'aave-v3', symbol: 'USD₮', tvlUsd: 1_568_456, apy: 6.08, apyBase: 0.24, apyReward: 5.84, stablecoin: false }),
  pool({ pool: 'aave-usdc', chain: 'Celo', project: 'aave-v3', symbol: 'USDC', tvlUsd: 72_998, apy: 0.5, apyBase: 0.5, apyReward: 0, apyMean30d: 0.5 }),
  pool({ pool: 'uni-usdt-usat', chain: 'Celo', project: 'uniswap-v3', symbol: 'USD₮-USAT', tvlUsd: 144_489, apy: 0.22, apyBase: 0.22, apyReward: 0, ilRisk: 'yes', exposure: 'multi' }),
  pool({ pool: 'uni-usdt-wbtc', chain: 'Celo', project: 'uniswap-v3', symbol: 'USD₮-WBTC', tvlUsd: 228_556, apy: 34.44, apyBase: 21.58, apyReward: 12.87, stablecoin: false, ilRisk: 'yes', exposure: 'multi' }),
  pool({ pool: 'moola-cusd', chain: 'Celo', project: 'moola-market', symbol: 'CUSD', tvlUsd: 394_245, apy: 0.41, apyBase: 0.41, apyReward: 0, apyMean30d: 0.4 }),
  pool({ pool: 'base-usdc', chain: 'Base', project: 'aave-v3', symbol: 'USDC', tvlUsd: 400_000_000, apy: 4.1, apyBase: 4.1, apyReward: 0, apyMean30d: 3.9 }),
];

describe('reading one pool honestly', () => {
  it('separates steady interest from temporary rewards', () => {
    const a = assess(REAL[0])!;
    expect(a.apyBase).toBeCloseTo(0.24);
    expect(a.apyReward).toBeCloseTo(5.84);
    expect(a.rewardShare).toBeGreaterThan(0.9);
    expect(a.flags.join(' | ')).toMatch(/96% of the headline rate is temporary rewards/);
    expect(a.risk).toBe('medium');
  });
  it('a big lending pool with steady interest is the lower-risk end, but nothing is called safe', () => {
    const a = assess(REAL[5])!;
    expect(a.risk).toBe('lower');
    expect(a.flags).toEqual([]);
  });
  it('flags a small pool, an LP pair, price risk, a spike and an outlier', () => {
    expect(assess(pool({ tvlUsd: 100_000 }))!.risk).toBe('high');
    expect(assess(REAL[2])!.flags.join(' ')).toMatch(/impermanent loss/);
    expect(assess(REAL[3])!.risk).toBe('high');
    expect(assess(pool({ apy: 12, apyBase: 12, apyReward: 0, apyMean30d: 4 }))!.flags.join(' ')).toMatch(/30-day average/);
    expect(assess(pool({ outlier: true }))!.flags.join(' ')).toMatch(/statistical outlier/);
  });
  it('returns null for unusable data', () => {
    expect(assess(pool({ tvlUsd: 0 }))).toBeNull();
    expect(assess(pool({ pool: '' }))).toBeNull();
  });
  it('knows lending, liquidity pools and staking apart', () => {
    expect(kindOf('aave-v3')).toBe('lending');
    expect(kindOf('uniswap-v3')).toBe('liquidity pool');
    expect(kindOf('lido')).toBe('staking');
    expect(kindOf('some-new-thing')).toBe('other');
  });
});

describe('ranking', () => {
  it('ranks by steady pay, not the headline number, and drops small pools and non-stable pools by default', () => {
    const r = rankPools(REAL, { chains: ['celo'] });
    // The 6.08% USDT pool is mostly rewards: 0.24 + 0.4*5.84 = 2.58 steady, still ahead of the 0.5% USDC pool, which is too small to list.
    expect(r.map((p) => p.id)).toEqual(['aave-usdt', 'moola-cusd']);
  });
  it('lists every asset kind only when asked', () => {
    const r = rankPools(REAL, { chains: ['Celo'], assets: 'any', minTvlUsd: 100_000 });
    expect(r.map((p) => p.id)).toContain('uni-usdt-wbtc');
    expect(r[0].id).toBe('uni-usdt-wbtc');
  });
  it('filters by chain and symbol, in any case', () => {
    expect(rankPools(REAL, { chains: ['BASE'], symbol: 'usdc' }).map((p) => p.id)).toEqual(['base-usdc']);
    expect(rankPools(REAL, { chains: ['Celo'], symbol: 'usat', minTvlUsd: 100_000, assets: 'any' }).map((p) => p.id)).toEqual(['uni-usdt-usat']);
  });
  it('covers every chain when none is named, and respects the limit', () => {
    expect(rankPools(REAL, {}).some((p) => p.chain === 'Base')).toBe(true);
    expect(rankPools(REAL, { limit: 1 })).toHaveLength(1);
    expect(rankPools(Array.from({ length: 30 }, (_, i) => pool({ pool: 'x' + i })), { limit: 99 })).toHaveLength(8);
  });
  it('keeps data-source outliers in the list (it flags big Aave pools too), but flagged', () => {
    const r = rankPools([pool({ outlier: true })], {});
    expect(r).toHaveLength(1);
    expect(r[0].flags.join(' ')).toMatch(/statistical outlier/);
  });
});

describe('explaining an empty answer', () => {
  it('says when a coin only trades and never lends', () => {
    expect(coverageNote(REAL, 'Celo', 'USAT')).toMatch(/only appears in trading pools/);
  });
  it('says when a coin has no pools at all', () => {
    expect(coverageNote(REAL, 'Celo', 'DOGE')).toMatch(/no pools/);
  });
  it('says nothing when there is a lending market', () => {
    expect(coverageNote(REAL, 'Celo', 'USDC')).toBeNull();
  });
});

import { queryFrom } from './rank';
import { toRawPools } from './parse';

describe('reading the model’s arguments', () => {
  it('defaults to stablecoins and keeps only sane values', () => {
    expect(queryFrom({})).toEqual({ chains: [], assets: 'stablecoins' });
    expect(queryFrom({ chains: ['Celo', 42, ' Base '], assets: 'any', symbol: ' usdc ', minTvlUsd: -5, limit: 3.4 })).toEqual({ chains: ['Celo', 'Base'], assets: 'any', symbol: 'usdc', minTvlUsd: 0, limit: 3 });
    expect(queryFrom({ assets: 'whatever', chains: 'celo' })).toEqual({ chains: [], assets: 'stablecoins' });
  });
});

describe('reading the data source', () => {
  it('keeps well-formed pools and skips broken ones', () => {
    const json = { data: [{ pool: 'a', chain: 'Celo', project: 'aave-v3', symbol: 'USDC', tvlUsd: 5, apy: 1, apyBase: 1, apyReward: null, stablecoin: true }, { chain: 'Celo' }, null, { pool: 'b', chain: 'Base', symbol: 'ETH', tvlUsd: 'x' }] };
    const out = toRawPools(json);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ pool: 'a', apyReward: null, stablecoin: true, outlier: false });
    expect(toRawPools({})).toEqual([]);
  });
});

import { isStable } from './rank';

describe('what counts as a stablecoin pool', () => {
  it('trusts the source, and also recognises coins by name', () => {
    expect(isStable({ symbol: 'USD₮', stablecoin: false })).toBe(true);
    expect(isStable({ symbol: 'USD₮-USAT', stablecoin: false })).toBe(true);
    expect(isStable({ symbol: 'USDC', stablecoin: true })).toBe(true);
    expect(isStable({ symbol: 'WETH', stablecoin: false })).toBe(false);
    expect(isStable({ symbol: 'USD₮-WBTC', stablecoin: false })).toBe(false);
  });
  it('does not call a very high stablecoin rate lower risk', () => {
    expect(assess(pool({ apy: 27, apyBase: 27, apyReward: 0, apyMean30d: 26 }))!.risk).toBe('high');
    expect(assess(pool({ apy: 14, apyBase: 14, apyReward: 0, apyMean30d: 14 }))!.risk).toBe('medium');
  });
});

import { depositTokenFor } from './rank';

describe('which pools Pexa can deposit into', () => {
  it('only Aave v3 on Celo, for USDT and USDC', () => {
    expect(depositTokenFor({ chain: 'Celo', project: 'aave-v3', symbol: 'USD₮' })).toBe('USDT');
    expect(depositTokenFor({ chain: 'Celo', project: 'aave-v3', symbol: 'USDC' })).toBe('USDC');
    expect(depositTokenFor({ chain: 'Celo', project: 'aave-v3', symbol: 'WETH' })).toBeNull();
    expect(depositTokenFor({ chain: 'Base', project: 'aave-v3', symbol: 'USDC' })).toBeNull();
    expect(depositTokenFor({ chain: 'Celo', project: 'moola-market', symbol: 'CUSD' })).toBeNull();
    expect(depositTokenFor({ chain: 'Celo', project: 'uniswap-v3', symbol: 'USD₮-USAT' })).toBeNull();
  });
  it('is carried on the ranked pool', () => {
    const aave = assess(pool({ pool: 'a', project: 'aave-v3', symbol: 'USD₮', stablecoin: false }))!;
    expect(aave.depositToken).toBe('USDT');
    expect(assess(pool({ pool: 'b', chain: 'Base', project: 'aave-v3', symbol: 'USDC' }))!.depositToken).toBeNull();
  });
});
