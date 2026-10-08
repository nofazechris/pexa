import { describe, expect, it } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  SWAP_LIMITS,
  UNISWAP,
  buildApprove,
  buildSwap,
  encodePath,
  formatAmount,
  isExpectedSwapTx,
  minimumOut,
  parseAmount,
  quoteLooksSane,
  routeFor,
  tokenAddress,
} from './route';

const WALLET = '0x52c23c312b27c8361bc37e7c8429f0328c7f5f2a' as const;

describe('routeFor', () => {
  it('direct pools and the hop through USDT', () => {
    expect(routeFor('USDC', 'USDT')).toEqual({ tokens: ['USDC', 'USDT'], fees: [100] });
    expect(routeFor('USDT', 'USAT')).toEqual({ tokens: ['USDT', 'USAT'], fees: [100] });
    expect(routeFor('USDC', 'USAT')).toEqual({ tokens: ['USDC', 'USDT', 'USAT'], fees: [100, 100] });
    expect(routeFor('USAT', 'USDC')).toEqual({ tokens: ['USAT', 'USDT', 'USDC'], fees: [100, 100] });
  });
  it('no route from a token to itself', () => expect(routeFor('USDC', 'USDC')).toBeNull());
});

describe('encodePath', () => {
  it('is token, fee, token, fee, token (20 + 3 + 20 + 3 + 20 bytes)', () => {
    const path = encodePath(routeFor('USDC', 'USAT')!);
    expect((path.length - 2) / 2).toBe(66);
    expect(path.toLowerCase().startsWith('0x' + tokenAddress('USDC').slice(2).toLowerCase() + '000064')).toBe(true);
    expect(path.toLowerCase().endsWith(tokenAddress('USAT').slice(2).toLowerCase())).toBe(true);
  });
});

describe('amounts', () => {
  it.each([
    ['5', 5_000_000n],
    ['$5', 5_000_000n],
    ['5.25', 5_250_000n],
    ['0.1', 100_000n],
    ['1,250.5', 1_250_500_000n],
    ['0.000001', 1n],
  ])('parses %s', (text, want) => expect(parseAmount(text)).toBe(want));
  it.each(['', 'abc', '-5', '5.1234567', '1e6', '5 usdc', '.5'])('rejects %s', (text) => expect(parseAmount(text)).toBeNull());
  it('formats for people', () => {
    expect(formatAmount(5_000_000n)).toBe('5.00');
    expect(formatAmount(1_001_118n)).toBe('1.00');
    expect(formatAmount(1_001_118n, 4)).toBe('1.0011');
    expect(formatAmount(4_000n)).toBe('0.004');
    expect(formatAmount(4_158_918n, 6)).toBe('4.158918');
    expect(formatAmount(4_158_900n, 6)).toBe('4.1589');
    expect(formatAmount(5_000_000n, 6)).toBe('5.00');
    expect(formatAmount(4_163_500n, 4)).toBe('4.1635');
  });
  it('the beta limits are $0.10 to $250', () => {
    expect(SWAP_LIMITS.minAtomic).toBe(100_000n);
    expect(SWAP_LIMITS.maxAtomic).toBe(250_000_000n);
  });
});

describe('slippage and sanity', () => {
  it('minimum out is the quote less 0.5%, rounded down', () => {
    expect(minimumOut(10_000_000n)).toBe(9_950_000n);
    expect(minimumOut(1_001_118n)).toBe(996_112n);
  });
  it('accepts a normal dollar-coin quote and refuses a skewed one', () => {
    expect(quoteLooksSane(1_000_000n, 1_001_118n)).toBe(true);
    expect(quoteLooksSane(1_000_000n, 999_000n)).toBe(true);
    expect(quoteLooksSane(1_000_000n, 950_000n)).toBe(false);
    expect(quoteLooksSane(1_000_000n, 1_050_000n)).toBe(false);
    expect(quoteLooksSane(1_000_000n, 0n)).toBe(false);
  });
});

describe('transactions', () => {
  const route = routeFor('USDC', 'USAT')!;
  it('the swap sends the result to the wallet with the exact amounts', () => {
    const tx = buildSwap(route, WALLET, 5_000_000n, 4_975_000n);
    expect(tx.to).toBe(UNISWAP.router);
    const decoded = decodeFunctionData({
      abi: [{ name: 'exactInput', type: 'function', stateMutability: 'payable', inputs: [{ name: 'params', type: 'tuple', components: [{ name: 'path', type: 'bytes' }, { name: 'recipient', type: 'address' }, { name: 'amountIn', type: 'uint256' }, { name: 'amountOutMinimum', type: 'uint256' }] }], outputs: [{ type: 'uint256' }] }],
      data: tx.data,
    });
    const p = (decoded.args as unknown as [{ path: string; recipient: string; amountIn: bigint; amountOutMinimum: bigint }])[0];
    expect(p.recipient.toLowerCase()).toBe(WALLET);
    expect(p.amountIn).toBe(5_000_000n);
    expect(p.amountOutMinimum).toBe(4_975_000n);
    expect(p.path).toBe(encodePath(route));
  });
  it('the approval is for exactly the amount, to the router', () => {
    const tx = buildApprove('USDC', 5_000_000n);
    expect(tx.to).toBe(tokenAddress('USDC'));
    expect(tx.data.startsWith('0x095ea7b3')).toBe(true);
    expect(tx.data.toLowerCase()).toContain(UNISWAP.router.slice(2).toLowerCase());
    expect(BigInt('0x' + tx.data.slice(-64))).toBe(5_000_000n);
  });
  it('the browser only signs the expected calls', () => {
    expect(isExpectedSwapTx(buildApprove('USDC', 5_000_000n), 'USDC')).toBe(true);
    expect(isExpectedSwapTx(buildSwap(route, WALLET, 5_000_000n, 1n), 'USDC')).toBe(true);
    // approving some other token, a different spender, a transfer to someone, or sending CELO — all refused
    expect(isExpectedSwapTx(buildApprove('USDT', 5_000_000n), 'USDC')).toBe(false);
    const evilSpender = { ...buildApprove('USDC', 5n), data: buildApprove('USDC', 5n).data.replace(UNISWAP.router.slice(2).toLowerCase(), '1111111111111111111111111111111111111111') as `0x${string}` };
    expect(isExpectedSwapTx(evilSpender, 'USDC')).toBe(false);
    expect(isExpectedSwapTx({ ...buildSwap(route, WALLET, 5n, 1n), to: '0x1111111111111111111111111111111111111111' }, 'USDC')).toBe(false);
    expect(isExpectedSwapTx({ ...buildSwap(route, WALLET, 5n, 1n), value: '1' as never }, 'USDC')).toBe(false);
    expect(isExpectedSwapTx({ ...buildSwap(route, WALLET, 5n, 1n), chainId: 1 }, 'USDC')).toBe(false);
  });
});
