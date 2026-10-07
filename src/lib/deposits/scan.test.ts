import { describe, expect, it } from 'vitest';
import { INITIAL_LOOKBACK, MAX_SLICES_PER_RUN, SLICE_BLOCKS, planScan, toDeposit, type DecodedTransfer } from './scan';

describe('planScan — never ask the chain for more than it allows', () => {
  it('a brand-new wallet looks back a short while, not through all history', () => {
    const p = planScan(null, 80_000_000);
    expect(p.slices[0][0]).toBe(80_000_000 - INITIAL_LOOKBACK);
    expect(p.slices[p.slices.length - 1][1]).toBe(80_000_000);
    expect(p.caughtUp).toBe(true);
  });

  it('every slice is within the 5,000-block limit, contiguous, and in order', () => {
    const p = planScan(1_000, 1_000 + 12_345);
    for (const [a, b] of p.slices) expect(b - a + 1).toBeLessThanOrEqual(SLICE_BLOCKS);
    for (let i = 1; i < p.slices.length; i++) expect(p.slices[i][0]).toBe(p.slices[i - 1][1] + 1);
    expect(p.slices[0][0]).toBe(1_001);
  });

  it('continues exactly after the last finished block (no gap, no overlap)', () => {
    expect(planScan(500, 600).slices).toEqual([[501, 600]]);
  });

  it('does nothing when already at the tip', () => {
    expect(planScan(600, 600)).toEqual({ slices: [], endBlock: null, caughtUp: true });
    expect(planScan(700, 600).slices).toEqual([]);
  });

  it('a wallet that is far behind catches up a bounded amount per run, then keeps going next run', () => {
    const latest = 10_000_000;
    const p = planScan(1_000_000, latest);
    expect(p.slices).toHaveLength(MAX_SLICES_PER_RUN);
    expect(p.caughtUp).toBe(false);
    expect(p.endBlock).toBe(1_000_000 + MAX_SLICES_PER_RUN * SLICE_BLOCKS);
    // the next run picks up right where this one ended
    expect(planScan(p.endBlock, latest).slices[0][0]).toBe(p.endBlock! + 1);
  });
});

const USDC = '0xcebA9300f2b948710d2653dD7B07f33A8B32118C';
const USAT = '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771';
const TOKENS = { USDC, USDT: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e', USAT };
const ME = '0x52c23C312B27c8361BC37E7c8429F0328c7F5F2A';
const OTHER = '0x1111111111111111111111111111111111111111';
type EvOver = Omit<Partial<DecodedTransfer>, 'args'> & { args?: Partial<DecodedTransfer['args']> };
const ev = (over: EvOver = {}): DecodedTransfer => ({
  address: USDC,
  blockNumber: 79_000_000n,
  logIndex: 3,
  transactionHash: '0xABCDEF' + '0'.repeat(58),
  ...over,
  args: { from: OTHER, to: ME, value: 2_000_000n, ...over.args },
});

describe('toDeposit', () => {
  it('recognises money arriving from outside, naming the token and exact amount', () => {
    expect(toDeposit(ev(), ME, TOKENS)).toEqual({ token: 'USDC', amountAtomic: '2000000', from: OTHER, txHash: '0xabcdef' + '0'.repeat(58), logIndex: 3, blockNumber: 79_000_000 });
    expect(toDeposit(ev({ address: USAT.toLowerCase() }), ME, TOKENS)?.token).toBe('USAT');
  });

  it('is case-insensitive about the wallet', () => {
    expect(toDeposit(ev({ args: { to: ME.toLowerCase() } }), ME.toUpperCase().replace('0X', '0x'), TOKENS)).not.toBeNull();
  });

  it('ignores a token we do not know (a worthless look-alike coin)', () => {
    expect(toDeposit(ev({ address: OTHER }), ME, TOKENS)).toBeNull();
  });

  it('ignores transfers to someone else, from yourself, of nothing, or without a log index', () => {
    expect(toDeposit(ev({ args: { to: OTHER } }), ME, TOKENS)).toBeNull();
    expect(toDeposit(ev({ args: { from: ME } }), ME, TOKENS)).toBeNull();
    expect(toDeposit(ev({ args: { value: 0n } }), ME, TOKENS)).toBeNull();
    expect(toDeposit(ev({ logIndex: null }), ME, TOKENS)).toBeNull();
  });
});
