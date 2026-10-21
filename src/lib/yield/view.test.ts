import { describe, expect, it } from 'vitest';
import { buildYieldView, YIELD_DISCLAIMER } from './view';
import type { RawPool } from './rank';

const pool = (over: Partial<RawPool>): RawPool => ({ pool: 'p', chain: 'Celo', project: 'aave-v3', symbol: 'USD₮', tvlUsd: 1_500_000, apy: 6, apyBase: 0.2, apyReward: 5.8, apyMean30d: 5.5, stablecoin: true, ilRisk: 'no', exposure: 'single', outlier: false, ...over });
const AT = new Date('2026-10-21T12:00:00Z');

describe('the yield card notes', () => {
  it('always carries the disclaimer, last', () => {
    const v = buildYieldView([pool({})], { chains: ['celo'] }, AT);
    expect(v.notes.at(-1)).toBe(YIELD_DISCLAIMER);
    expect(v.asOf).toBe('2026-10-21T12:00:00.000Z');
  });
  it('explains that rewards are temporary when most of the rate is rewards', () => {
    expect(buildYieldView([pool({})], {}, AT).notes.join(' ')).toMatch(/Rewards are temporary/);
    expect(buildYieldView([pool({ apy: 4, apyBase: 4, apyReward: 0 })], {}, AT).notes.join(' ')).not.toMatch(/Rewards are temporary/);
  });
  it('says research-only for pools off Celo', () => {
    expect(buildYieldView([pool({ chain: 'Base', pool: 'b' })], {}, AT).notes.join(' ')).toMatch(/research only/);
    expect(buildYieldView([pool({})], { chains: ['Celo'] }, AT).notes.join(' ')).not.toMatch(/research only/);
  });
  it('explains an empty answer for a coin with no lending market', () => {
    const uniswap = pool({ pool: 'u', project: 'uniswap-v3', symbol: 'USD₮-USAT', tvlUsd: 100_000 });
    const v = buildYieldView([uniswap], { chains: ['Celo'], symbol: 'USAT' }, AT);
    expect(v.items).toEqual([]);
    expect(v.notes[0]).toMatch(/only appears in trading pools/);
  });
  it('says USAT has no lending market when it is asked about and found only in trading pools', () => {
    const uniswap = pool({ pool: 'u', project: 'uniswap-v3', symbol: 'USD₮-USAT', tvlUsd: 400_000, apy: 1, apyBase: 1, apyReward: 0, stablecoin: true });
    const v = buildYieldView([uniswap], { chains: ['Celo'], symbol: 'USAT', minTvlUsd: 100_000 }, AT);
    expect(v.notes.join(' ')).toMatch(/USAT has no lending market on Celo/);
  });
});
