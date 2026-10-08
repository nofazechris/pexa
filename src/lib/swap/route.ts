import { encodeFunctionData, encodePacked, erc20Abi, getAddress, parseUnits, type Address, type Hex } from 'viem';
import { PAY_TOKENS } from '@/lib/buy/tokens';

/**
 * Converting between the dollar stablecoins on Celo (USDC ⇄ USDT ⇄ USAT) through Uniswap v3.
 *
 * Pure: routes, amounts and the exact transaction data. The same code runs on the server (to prepare and to verify)
 * and in the browser (to check what it is about to sign), so what the person sees is what gets signed.
 */

export type SwapToken = 'USDC' | 'USDT' | 'USAT';
export const SWAP_TOKENS: SwapToken[] = ['USDC', 'USDT', 'USAT'];

export const CELO_CHAIN_ID = 42220;

/** Uniswap v3 on Celo (checked on-chain: each has deployed code and the pools below exist). */
export const UNISWAP = {
  factory: getAddress('0xafe208a311b21f13ef87e33a90049fc17a7acdec'),
  quoter: getAddress('0x82825d0554fa07f7fc52ab63c961f330fdefa8e8'),
  router: getAddress('0x5615cdab10dc425a742d643d949a7f474c01abc4'),
} as const;

export const tokenAddress = (t: SwapToken): Address => getAddress(PAY_TOKENS[t].address);
export const isSwapToken = (v: unknown): v is SwapToken => v === 'USDC' || v === 'USDT' || v === 'USAT';

/** The 0.01% pools hold essentially all the liquidity: USDC⇄USDT and USDT⇄USAT. USDC⇄USAT hops through USDT. */
const POOL_FEE = 100;
const EDGES: Array<[SwapToken, SwapToken]> = [
  ['USDC', 'USDT'],
  ['USDT', 'USAT'],
];

export interface SwapRoute {
  tokens: SwapToken[];
  fees: number[];
}

export function routeFor(from: SwapToken, to: SwapToken): SwapRoute | null {
  if (from === to) return null;
  const direct = EDGES.some(([a, b]) => (a === from && b === to) || (a === to && b === from));
  if (direct) return { tokens: [from, to], fees: [POOL_FEE] };
  const viaUsdt = (from === 'USDC' && to === 'USAT') || (from === 'USAT' && to === 'USDC');
  return viaUsdt ? { tokens: [from, 'USDT', to], fees: [POOL_FEE, POOL_FEE] } : null;
}

/** Uniswap's packed path: token, fee, token[, fee, token]. */
export function encodePath(route: SwapRoute): Hex {
  const types: string[] = [];
  const values: Array<Address | number> = [];
  route.tokens.forEach((t, i) => {
    types.push('address');
    values.push(tokenAddress(t));
    if (i < route.fees.length) {
      types.push('uint24');
      values.push(route.fees[i]);
    }
  });
  return encodePacked(types as never, values as never);
}

/* ----------------------------------------------------------------- amounts and limits */

export const DECIMALS = 6;
/** Beta limits: too small and gas isn't worth it; too large and we want a human to look first. */
export const SWAP_LIMITS = { minAtomic: 100_000n, maxAtomic: 250_000_000n } as const; // $0.10 – $250
export const SLIPPAGE_BPS = 50; // 0.5%

/** "5", "5.25", "0.1" → atomic units; anything else (negative, 7+ decimals, junk) → null. */
export function parseAmount(text: string): bigint | null {
  const t = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,6})?$/.test(t)) return null;
  try {
    return parseUnits(t, DECIMALS);
  } catch {
    return null;
  }
}

export function formatAmount(atomic: bigint, maxDecimals = 2): string {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, '0');
  let f = frac.slice(0, Math.max(maxDecimals, 0));
  // Show a little more precision for small amounts so "0.004" doesn't read as "0.00".
  if (maxDecimals < 6 && whole === 0n && atomic > 0n) f = frac.slice(0, 4);
  // Past two decimals, drop trailing zeros ("4.158900" → "4.1589") but always keep cents ("5.000000" → "5.00").
  if (f.length > 2) f = f.replace(/0+$/, '').padEnd(2, '0');
  return f ? `${whole.toLocaleString('en-US')}.${f}` : whole.toLocaleString('en-US');
}

/** The least we accept: the quote less the slippage allowance (rounded down). */
export function minimumOut(expected: bigint, slippageBps = SLIPPAGE_BPS): bigint {
  return (expected * BigInt(10_000 - slippageBps)) / 10_000n;
}

/**
 * These are all one-dollar coins, so a sane quote is within about 1% of the amount put in. Anything else means the pool
 * is out of balance or being manipulated — refuse rather than hand over a bad price.
 */
export function quoteLooksSane(amountIn: bigint, expectedOut: bigint, toleranceBps = 100): boolean {
  if (amountIn <= 0n || expectedOut <= 0n) return false;
  const lo = (amountIn * BigInt(10_000 - toleranceBps)) / 10_000n;
  const hi = (amountIn * BigInt(10_000 + toleranceBps)) / 10_000n;
  return expectedOut >= lo && expectedOut <= hi;
}

/* ----------------------------------------------------------------- transactions */

const exactInputAbi = [
  {
    name: 'exactInput',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const;

export interface SwapTx {
  kind: 'approve' | 'swap';
  to: Address;
  data: Hex;
  value: '0';
  chainId: number;
}

/** Let the router take exactly this amount (never an unlimited approval). */
export function buildApprove(token: SwapToken, amountIn: bigint): SwapTx {
  return {
    kind: 'approve',
    to: tokenAddress(token),
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [UNISWAP.router, amountIn] }),
    value: '0',
    chainId: CELO_CHAIN_ID,
  };
}

/** The swap itself. The result is sent straight to the person's own wallet. */
export function buildSwap(route: SwapRoute, recipient: Address, amountIn: bigint, amountOutMinimum: bigint): SwapTx {
  return {
    kind: 'swap',
    to: UNISWAP.router,
    data: encodeFunctionData({ abi: exactInputAbi, functionName: 'exactInput', args: [{ path: encodePath(route), recipient, amountIn, amountOutMinimum }] }),
    value: '0',
    chainId: CELO_CHAIN_ID,
  };
}

/** Is this something the browser should be willing to sign for a swap? Only an approve of the paid token to the router, or the router call. */
export function isExpectedSwapTx(tx: SwapTx, from: SwapToken): boolean {
  if (tx.value !== '0' || tx.chainId !== CELO_CHAIN_ID) return false;
  if (tx.kind === 'swap') return tx.to.toLowerCase() === UNISWAP.router.toLowerCase();
  if (tx.kind === 'approve') {
    if (tx.to.toLowerCase() !== tokenAddress(from).toLowerCase()) return false;
    // approve(router, amount) — selector 0x095ea7b3 and the router as the spender, nothing else.
    return tx.data.startsWith('0x095ea7b3') && tx.data.slice(34, 74).toLowerCase() === UNISWAP.router.slice(2).toLowerCase();
  }
  return false;
}
