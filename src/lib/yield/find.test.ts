import { describe, expect, it } from 'vitest';
import { findPool, normSymbol } from './find';
import type { RawPool } from './rank';

const pool = (over: Partial<RawPool>): RawPool => ({ pool: 'p', chain: 'Celo', project: 'aave-v3', symbol: 'USD₮', tvlUsd: 1_000_000, apy: 1, apyBase: 1, apyReward: 0, apyMean30d: 1, stablecoin: true, ilRisk: 'no', exposure: 'single', outlier: false, ...over });
const POOLS = [
  pool({ pool: 'a', tvlUsd: 1_568_456 }),
  pool({ pool: 'b', project: 'uniswap-v3', symbol: 'USD₮-USDC', tvlUsd: 187_705 }),
  pool({ pool: 'c', project: 'aave-v3', symbol: 'USDC', tvlUsd: 72_998 }),
  pool({ pool: 'd', chain: 'Base', project: 'aave-v3', symbol: 'USDC', tvlUsd: 400_000_000 }),
];

describe('finding the pool a person means', () => {
  it('matches the tether sign and plain USDT alike', () => {
    expect(normSymbol('USD₮')).toBe('usdt');
    expect(findPool(POOLS, { chain: 'celo', project: 'aave', symbol: 'usdt' })?.pool.pool).toBe('a');
  });
  it('picks the biggest when several match, and says how many others there were', () => {
    const r = findPool(POOLS, { chain: 'Celo', symbol: 'usdt' });
    expect(r?.pool.pool).toBe('a');
    expect(r?.others).toBe(1);
  });
  it('keeps chains apart', () => {
    expect(findPool(POOLS, { chain: 'Base', symbol: 'usdc' })?.pool.pool).toBe('d');
    expect(findPool(POOLS, { chain: 'Celo', symbol: 'usdc', project: 'aave' })?.pool.pool).toBe('c');
  });
  it('finds by id, and returns null for nothing', () => {
    expect(findPool(POOLS, { poolId: 'c' })?.pool.project).toBe('aave-v3');
    expect(findPool(POOLS, { poolId: 'zzz' })).toBeNull();
    expect(findPool(POOLS, { chain: 'Celo', symbol: 'doge' })).toBeNull();
    expect(findPool(POOLS, { symbol: 'usdc' })).toBeNull();
  });
});
