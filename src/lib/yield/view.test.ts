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

const aaveUsdt = pool({ pool: 'u', symbol: 'USD₮', stablecoin: false, apy: 6.08, apyBase: 0.24, apyReward: 5.84, tvlUsd: 1_568_456 });
const aaveUsdc = pool({ pool: 'c', symbol: 'USDC', stablecoin: true, apy: 0.5, apyBase: 0.5, apyReward: 0, tvlUsd: 400_000, apyMean30d: 0.5 });
const HOLD = { USDC: '12', USDT: '0', USAT: '0' };

describe('the person named a coin: the answer is about that coin, and the difference is said openly', () => {
  it('lists the coin they asked about, not whatever ranks first', () => {
    const v = buildYieldView([aaveUsdt, aaveUsdc], { chains: ['Celo'], symbol: 'USDC' }, AT, { holdings: HOLD });
    expect(v.items.map((p) => p.symbol)).toEqual(['USDC']);
  });
  it('says another coin pays more, with how much of it is temporary, and offers to convert — it never just switches', () => {
    const v = buildYieldView([aaveUsdt, aaveUsdc], { chains: ['Celo'], symbol: 'USDC' }, AT, { holdings: HOLD });
    expect(v.convert).toMatchObject({ from: 'USDC', to: 'USDT' });
    const note = v.notes.find((n) => /You asked about USDC/.test(n)) ?? '';
    expect(note).toMatch(/USDT on aave-v3 pays 0\.24% steady plus 5\.84% temporary rewards/);
    expect(note).toMatch(/USDC pays 0\.50% steady/);
    expect(note).toMatch(/You hold \$12\.00 USDC/);
    expect(note).toMatch(/your call/);
  });
  it('offers nothing when the coin they asked about already pays about the same or more', () => {
    const better = { ...aaveUsdc, pool: 'c2', apy: 7, apyBase: 7, apyMean30d: 7, tvlUsd: 2_000_000 };
    expect(buildYieldView([aaveUsdt, better], { chains: ['Celo'], symbol: 'USDC' }, AT, { holdings: HOLD }).convert).toBeNull();
  });
  it('without a named coin there is no comparison to make', () => {
    expect(buildYieldView([aaveUsdt, aaveUsdc], { chains: ['Celo'] }, AT, { holdings: HOLD }).convert).toBeNull();
  });
});

describe('what the person holds', () => {
  it('tells them when they hold none of the coin the best pool takes, and what to do about it', () => {
    const v = buildYieldView([aaveUsdt], { chains: ['Celo'] }, AT, { holdings: HOLD });
    expect(v.notes.join(' ')).toMatch(/You hold \$0\.00 USDT and \$12\.00 USDC, so I can convert some USDC to USDT first/);
  });
  it('tells them the minimum when they hold neither', () => {
    const v = buildYieldView([aaveUsdt], { chains: ['Celo'] }, AT, { holdings: { USDC: '0', USDT: '0', USAT: '0' } });
    expect(v.notes.join(' ')).toMatch(/add funds first — the minimum to start is \$0\.10/);
  });
  it('says nothing about balances when they could not be read', () => {
    expect(buildYieldView([aaveUsdt], { chains: ['Celo'] }, AT).notes.join(' ')).not.toMatch(/You hold/);
  });
});
