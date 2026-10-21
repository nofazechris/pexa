import { describe, expect, it } from 'vitest';
import { getAddress } from 'viem';
import { AAVE, EARN_LIMITS, MAX_UINT256, buildApprove, buildSupply, buildWithdraw, isEarnToken, isExpectedEarnTx, rayToApyPercent, earnTokenAddress, type EarnTx } from './aave';
import { appendTag } from '@/lib/relayer/tag';

const ME = getAddress('0x1111111111111111111111111111111111111111');
const OTHER = getAddress('0x2222222222222222222222222222222222222222');
const TAG = 'celo_958bdac0d45b';
const tagged = (tx: EarnTx): EarnTx => ({ ...tx, data: appendTag(tx.data, TAG) });

describe('the Aave calldata', () => {
  it('uses the verified Celo pool and the real USDT and USDC contracts', () => {
    expect(AAVE.pool).toBe('0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402');
    expect(earnTokenAddress('USDT')).toBe('0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e');
    expect(earnTokenAddress('USDC')).toBe('0xcebA9300f2b948710d2653dD7B07f33A8B32118C');
  });
  it('only USDT and USDC can be deposited (USAT is not an Aave market)', () => {
    expect(isEarnToken('USDT')).toBe(true);
    expect(isEarnToken('USDC')).toBe(true);
    expect(isEarnToken('USAT')).toBe(false);
  });
  it('approves exactly the amount, to the pool', () => {
    const tx = buildApprove('USDT', 5_000_000n);
    expect(tx.to).toBe(earnTokenAddress('USDT'));
    expect(tx.data.toLowerCase()).toContain(AAVE.pool.slice(2).toLowerCase());
    expect(BigInt('0x' + tx.data.slice(-64))).toBe(5_000_000n);
  });
  it('limits are $0.10 to $25', () => {
    expect(EARN_LIMITS.minAtomic).toBe(100_000n);
    expect(EARN_LIMITS.maxAtomic).toBe(25_000_000n);
  });
});

describe('what the browser will sign', () => {
  const expectDeposit = { token: 'USDT' as const, action: 'deposit' as const, wallet: ME };
  it('accepts the approve and the deposit, with or without the attribution tag', () => {
    for (const wrap of [(t: EarnTx) => t, tagged]) {
      expect(isExpectedEarnTx(wrap(buildApprove('USDT', 1_000_000n)), expectDeposit)).toBe(true);
      expect(isExpectedEarnTx(wrap(buildSupply('USDT', 1_000_000n, ME)), expectDeposit)).toBe(true);
    }
  });
  it('accepts a withdrawal (including "everything") to the person’s own address', () => {
    const w = { token: 'USDC' as const, action: 'withdraw' as const, wallet: ME };
    expect(isExpectedEarnTx(buildWithdraw('USDC', 2_000_000n, ME), w)).toBe(true);
    expect(isExpectedEarnTx(tagged(buildWithdraw('USDC', MAX_UINT256, ME)), w)).toBe(true);
  });
  it('refuses a deposit credited to someone else, or a withdrawal sent to someone else', () => {
    expect(isExpectedEarnTx(buildSupply('USDT', 1_000_000n, OTHER), expectDeposit)).toBe(false);
    expect(isExpectedEarnTx(buildWithdraw('USDT', 1n, OTHER), { token: 'USDT', action: 'withdraw', wallet: ME })).toBe(false);
  });
  it('refuses the wrong coin, the wrong contract, the wrong action and any value', () => {
    expect(isExpectedEarnTx(buildSupply('USDC', 1_000_000n, ME), expectDeposit)).toBe(false);
    expect(isExpectedEarnTx({ ...buildSupply('USDT', 1_000_000n, ME), to: OTHER }, expectDeposit)).toBe(false);
    expect(isExpectedEarnTx(buildSupply('USDT', 1_000_000n, ME), { token: 'USDT', action: 'withdraw', wallet: ME })).toBe(false);
    expect(isExpectedEarnTx(buildWithdraw('USDT', 1n, ME), expectDeposit)).toBe(false);
    expect(isExpectedEarnTx({ ...buildApprove('USDT', 1n), value: '1' as never }, expectDeposit)).toBe(false);
  });
  it('refuses an approval to anyone but Aave, and an approval during a withdrawal', () => {
    const toOther = { ...buildApprove('USDT', 1n), data: buildApprove('USDT', 1n).data.replace(AAVE.pool.slice(2).toLowerCase(), OTHER.slice(2).toLowerCase()) } as EarnTx;
    expect(isExpectedEarnTx(toOther, expectDeposit)).toBe(false);
    expect(isExpectedEarnTx(buildApprove('USDT', 1n), { token: 'USDT', action: 'withdraw', wallet: ME })).toBe(false);
  });
});

describe('reading an Aave rate', () => {
  it('turns the ray rate into a compounded APY percent', () => {
    // 0.24% APR (2.4e24 ray) compounds to just over 0.24%.
    const apy = rayToApyPercent(24n * 10n ** 23n);
    expect(apy).toBeGreaterThan(0.24);
    expect(apy).toBeLessThan(0.25);
    expect(rayToApyPercent(0n)).toBe(0);
  });
});
