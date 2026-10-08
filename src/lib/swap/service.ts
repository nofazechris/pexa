import 'server-only';
import { and, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { decodeEventLog, erc20Abi, getAddress, parseAbi, type Address, type Hex } from 'viem';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, features, txExplorerUrl } from '@/lib/config';
import { celoClient } from '@/lib/celo/client';
import { getErc20Balance } from '@/lib/celo/balance';
import { getWalletByUserId } from '@/lib/wallets/service';
import { availableBalanceRaw } from '@/lib/vaults/service';
import { relayerCeloBalance, sendGasTopUp } from '@/lib/relayer/service';
import {
  SLIPPAGE_BPS,
  SWAP_LIMITS,
  UNISWAP,
  buildApprove,
  buildSwap,
  encodePath,
  formatAmount,
  minimumOut,
  parseAmount,
  quoteLooksSane,
  routeFor,
  tokenAddress,
  type SwapRoute,
  type SwapToken,
  type SwapTx,
} from './route';

/**
 * Converting USDC ⇄ USDT ⇄ USAT. The server quotes, remembers exactly what the person agreed to, tops up gas, checks every
 * step on-chain and reports what really arrived. The person's own wallet signs the approve and the swap — Pexa never
 * holds or moves their money.
 */

const QUOTE_TTL_MS = 3 * 60 * 1000;
/** Approve (~50k gas) + swap (~200k), with room to spare. */
const GAS_UNITS_NEEDED = 450_000n;
const MAX_TOP_UP_WEI = 300_000_000_000_000_000n; // 0.3 CELO, per top-up
const MIN_RELAYER_WEI = 1_000_000_000_000_000_000n; // stop topping up below 1 CELO left
const MAX_TOP_UPS_PER_DAY = 6;
const MAX_PREVIEWS_PER_HOUR = 20;

const quoterAbi = parseAbi(['function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)']);

export interface SwapPreview {
  swapId: string;
  from: SwapToken;
  to: SwapToken;
  /** Human amounts. */
  amountIn: string;
  expectedOut: string;
  minOut: string;
  /** What 1 of the paid coin buys, e.g. "1.0011". */
  rate: string;
  /** e.g. "USDC → USDT → USAT" */
  routeLabel: string;
  slippagePercent: string;
  expiresAt: string;
  network: string;
}

export type PreviewResult = { ok: true; preview: SwapPreview } | { ok: false; message: string };

export function swapsAvailable(): boolean {
  return features.gaslessRelayer && activeNetwork.network === 'mainnet';
}

async function quote(route: SwapRoute, amountIn: bigint): Promise<bigint> {
  const r = await celoClient().simulateContract({ address: UNISWAP.quoter, abi: quoterAbi, functionName: 'quoteExactInput', args: [encodePath(route), amountIn] });
  return r.result[0];
}

/** What the wallet can spend of this coin (USDC is net of what's set aside in savings vaults). */
async function spendable(userId: string, wallet: string, token: SwapToken): Promise<bigint> {
  const raw = await getErc20Balance(tokenAddress(token), wallet);
  return token === 'USDC' ? availableBalanceRaw(userId, raw.toString(), 'USDC') : raw;
}

function present(row: typeof schema.swaps.$inferSelect): SwapPreview {
  const route = JSON.parse(row.route) as SwapRoute;
  const amountIn = BigInt(row.amountIn);
  const expected = BigInt(row.expectedOut);
  const rate = amountIn > 0n ? Number((expected * 1_000_000n) / amountIn) / 1_000_000 : 0;
  return {
    swapId: row.id,
    from: row.fromToken as SwapToken,
    to: row.toToken as SwapToken,
    amountIn: formatAmount(amountIn, 6),
    expectedOut: formatAmount(expected, 4),
    minOut: formatAmount(BigInt(row.minOut), 4),
    rate: rate.toFixed(4),
    routeLabel: route.tokens.join(' → '),
    slippagePercent: (SLIPPAGE_BPS / 100).toString(),
    expiresAt: row.expiresAt.toISOString(),
    network: activeNetwork.name,
  };
}

/** Quote a conversion and remember it. Nothing moves until the person confirms and signs. */
export async function createSwapPreview(userId: string, from: SwapToken, to: SwapToken, amountText: string | 'all'): Promise<PreviewResult> {
  if (!swapsAvailable()) return { ok: false, message: 'Conversions aren’t switched on yet.' };
  const route = routeFor(from, to);
  if (!route) return { ok: false, message: `I can’t convert ${from} to ${to}.` };
  const wallet = await getWalletByUserId(userId);
  if (!wallet) return { ok: false, message: 'I couldn’t find your wallet yet. Open the Wallet tab once, then ask me again.' };

  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.swaps)
    .where(and(eq(schema.swaps.userId, userId), gt(schema.swaps.createdAt, new Date(Date.now() - 3_600_000))));
  if (n >= MAX_PREVIEWS_PER_HOUR) return { ok: false, message: 'That’s a lot of conversions in a short time — give it a few minutes and try again.' };

  const available = await spendable(userId, wallet.address, from);
  let amountIn: bigint;
  if (amountText === 'all') {
    amountIn = available;
  } else {
    const parsed = parseAmount(amountText);
    if (parsed === null) return { ok: false, message: 'I didn’t catch the amount — give me a number like 5 or 25.50.' };
    amountIn = parsed;
  }
  if (amountIn < SWAP_LIMITS.minAtomic) return { ok: false, message: 'The smallest conversion is $0.10.' };
  if (amountIn > SWAP_LIMITS.maxAtomic) return { ok: false, message: `In beta the largest single conversion is $${formatAmount(SWAP_LIMITS.maxAtomic)}. Try a smaller amount.` };
  if (amountIn > available) return { ok: false, message: `You have $${formatAmount(available)} ${from} available${from === 'USDC' ? ' (money set aside in vaults isn’t counted)' : ''} — that’s less than $${formatAmount(amountIn)}.` };

  let expected: bigint;
  try {
    expected = await quote(route, amountIn);
  } catch (e) {
    console.error('[swap] quote failed:', e instanceof Error ? e.message : e);
    return { ok: false, message: 'I couldn’t get a price right now. Nothing was changed — try again in a moment.' };
  }
  if (!quoteLooksSane(amountIn, expected)) {
    console.error('[swap] refusing an out-of-range quote', { from, to, amountIn: amountIn.toString(), expected: expected.toString() });
    return { ok: false, message: `The market price for ${from} → ${to} looks off right now, so I won’t convert. Try again later.` };
  }

  const [row] = await db
    .insert(schema.swaps)
    .values({
      userId,
      walletAddress: wallet.address,
      fromToken: from,
      toToken: to,
      amountIn: amountIn.toString(),
      expectedOut: expected.toString(),
      minOut: minimumOut(expected).toString(),
      route: JSON.stringify(route),
      status: 'PREVIEW',
      expiresAt: new Date(Date.now() + QUOTE_TTL_MS),
    })
    .returning();
  return { ok: true, preview: present(row) };
}

async function loadOwned(userId: string, swapId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(swapId)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.swaps)
    .where(and(eq(schema.swaps.id, swapId), eq(schema.swaps.userId, userId)))
    .limit(1);
  return row ?? null;
}

export type StepError = { ok: false; code: 'not_found' | 'expired' | 'price_moved' | 'insufficient' | 'gas_unavailable' | 'bad_state' | 'tx_mismatch' | 'tx_failed'; message: string };

export interface PreparedSwap {
  ok: true;
  from: string;
  needsApproval: boolean;
  txs: SwapTx[];
  allowed: { router: string; token: string };
}

/** The person tapped Confirm: re-check the price, make sure the wallet can pay gas, and hand back exactly what to sign. */
export async function prepareSwap(userId: string, swapId: string): Promise<PreparedSwap | StepError> {
  const row = await loadOwned(userId, swapId);
  if (!row) return { ok: false, code: 'not_found', message: 'I can’t find that conversion.' };
  if (row.status !== 'PREVIEW' && row.status !== 'PREPARED') return { ok: false, code: 'bad_state', message: 'That conversion was already handled.' };
  const db = getDb();
  if (row.expiresAt.getTime() < Date.now()) {
    await db.update(schema.swaps).set({ status: 'EXPIRED' }).where(eq(schema.swaps.id, row.id));
    return { ok: false, code: 'expired', message: 'That price expired. Ask me again for a fresh one.' };
  }

  const route = JSON.parse(row.route) as SwapRoute;
  const from = row.fromToken as SwapToken;
  const amountIn = BigInt(row.amountIn);
  const wallet = getAddress(row.walletAddress);

  // The price may have moved since the quote: never sign for less than what was agreed.
  let now: bigint;
  try {
    now = await quote(route, amountIn);
  } catch {
    return { ok: false, code: 'price_moved', message: 'I couldn’t re-check the price just now. Nothing was changed — try again.' };
  }
  if (now < BigInt(row.minOut)) {
    await db.update(schema.swaps).set({ status: 'EXPIRED', error: 'price_moved' }).where(eq(schema.swaps.id, row.id));
    return { ok: false, code: 'price_moved', message: 'The price moved while you were deciding. Ask me again for a fresh quote.' };
  }
  const bal = await getErc20Balance(tokenAddress(from), wallet);
  if (bal < amountIn) return { ok: false, code: 'insufficient', message: `Your ${from} balance is now lower than this conversion.` };

  // Gas: the wallet needs a little CELO to send the two transactions. Pexa covers it, once per conversion.
  if (!row.gasDripTx) {
    const client = celoClient();
    const [have, price, relayerHas] = await Promise.all([client.getBalance({ address: wallet }), client.getGasPrice(), relayerCeloBalance()]);
    const need = (price * GAS_UNITS_NEEDED * 3n) / 2n;
    if (have < need) {
      const topUp = need - have > MAX_TOP_UP_WEI ? MAX_TOP_UP_WEI : need - have;
      if (relayerHas === null || relayerHas < MIN_RELAYER_WEI) {
        console.error('[swap] relayer is low on CELO — cannot top up gas', relayerHas?.toString());
        return { ok: false, code: 'gas_unavailable', message: 'Conversions are paused for a moment on our side. Nothing was changed — please try again later.' };
      }
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.swaps)
        .where(and(eq(schema.swaps.userId, userId), isNotNull(schema.swaps.gasDripTx), gt(schema.swaps.createdAt, new Date(Date.now() - 86_400_000))));
      if (n >= MAX_TOP_UPS_PER_DAY) return { ok: false, code: 'gas_unavailable', message: 'You’ve hit today’s limit for conversions in beta. Try again tomorrow.' };
      try {
        const { hash } = await sendGasTopUp({ to: wallet, valueWei: topUp });
        await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 30_000 });
        await db.update(schema.swaps).set({ gasDripTx: hash }).where(eq(schema.swaps.id, row.id));
      } catch (e) {
        console.error('[swap] gas top-up failed:', e instanceof Error ? e.message : e);
        return { ok: false, code: 'gas_unavailable', message: 'I couldn’t prepare the network fee just now. Nothing was changed — try again in a moment.' };
      }
    } else {
      await db.update(schema.swaps).set({ gasDripTx: 'not_needed' }).where(eq(schema.swaps.id, row.id));
    }
  }

  const allowance = (await celoClient().readContract({ address: tokenAddress(from), abi: erc20Abi, functionName: 'allowance', args: [wallet, UNISWAP.router] })) as bigint;
  const needsApproval = allowance < amountIn;
  const txs: SwapTx[] = [];
  if (needsApproval) txs.push(buildApprove(from, amountIn));
  txs.push(buildSwap(route, wallet, amountIn, BigInt(row.minOut)));
  await db.update(schema.swaps).set({ status: 'PREPARED' }).where(eq(schema.swaps.id, row.id));
  return { ok: true, from: wallet, needsApproval, txs, allowed: { router: UNISWAP.router, token: tokenAddress(from) } };
}

/** The approval was sent: wait for it and check it did what we asked, before the swap is signed. */
export async function confirmApproval(userId: string, swapId: string, txHash: string): Promise<{ ok: true } | StepError> {
  const row = await loadOwned(userId, swapId);
  if (!row) return { ok: false, code: 'not_found', message: 'I can’t find that conversion.' };
  if (row.status !== 'PREPARED') return { ok: false, code: 'bad_state', message: 'That conversion isn’t waiting for an approval.' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, code: 'tx_mismatch', message: 'That doesn’t look like a transaction.' };
  const client = celoClient();
  const wallet = getAddress(row.walletAddress);
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 30_000 });
    if (receipt.status !== 'success') return { ok: false, code: 'tx_failed', message: 'The approval didn’t go through. Nothing was converted.' };
  } catch {
    return { ok: false, code: 'tx_failed', message: 'The approval is taking too long. Nothing was converted — try again.' };
  }
  const allowance = (await client.readContract({ address: tokenAddress(row.fromToken as SwapToken), abi: erc20Abi, functionName: 'allowance', args: [wallet, UNISWAP.router] })) as bigint;
  if (allowance < BigInt(row.amountIn)) return { ok: false, code: 'tx_mismatch', message: 'The approval doesn’t cover this conversion. Nothing was converted.' };
  await getDb().update(schema.swaps).set({ approveTx: txHash }).where(eq(schema.swaps.id, row.id));
  return { ok: true };
}

export interface SwapResult {
  ok: true;
  status: 'CONFIRMED' | 'PENDING';
  swapId: string;
  from: SwapToken;
  to: SwapToken;
  amountIn: string;
  amountOut: string | null;
  txHash: string;
  explorerUrl: string;
}

const TRANSFER_EVENT = erc20Abi.filter((x) => x.type === 'event' && x.name === 'Transfer');

/** The swap was sent: prove it's OUR swap, wait for it, and read what really arrived from the chain. Safe to call again. */
export async function finalizeSwap(userId: string, swapId: string, txHash: string): Promise<SwapResult | StepError> {
  const row = await loadOwned(userId, swapId);
  if (!row) return { ok: false, code: 'not_found', message: 'I can’t find that conversion.' };
  const from = row.fromToken as SwapToken;
  const to = row.toToken as SwapToken;
  const explorerUrl = (h: string) => txExplorerUrl(h);
  if (row.status === 'CONFIRMED' && row.swapTx) {
    return { ok: true, status: 'CONFIRMED', swapId: row.id, from, to, amountIn: formatAmount(BigInt(row.amountIn), 6), amountOut: row.amountOut ? formatAmount(BigInt(row.amountOut), 4) : null, txHash: row.swapTx, explorerUrl: explorerUrl(row.swapTx) };
  }
  if (row.status !== 'PREPARED') return { ok: false, code: 'bad_state', message: 'That conversion isn’t waiting to be finished.' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, code: 'tx_mismatch', message: 'That doesn’t look like a transaction.' };

  const client = celoClient();
  const wallet = getAddress(row.walletAddress);
  const route = JSON.parse(row.route) as SwapRoute;
  const db = getDb();

  const pendingResult = (): SwapResult => ({ ok: true, status: 'PENDING', swapId: row.id, from, to, amountIn: formatAmount(BigInt(row.amountIn), 6), amountOut: null, txHash, explorerUrl: explorerUrl(txHash) });

  // Right after sending, the node may not know the transaction yet: wait for it (this only reads the chain).
  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 25_000 });
  } catch {
    return pendingResult();
  }

  // It must be exactly the swap we prepared: from this wallet, to the router, with our calldata.
  let tx;
  try {
    tx = await client.getTransaction({ hash: txHash as Hex });
  } catch {
    return pendingResult();
  }
  const expected = buildSwap(route, wallet, BigInt(row.amountIn), BigInt(row.minOut));
  if (tx.from.toLowerCase() !== wallet.toLowerCase() || (tx.to ?? '').toLowerCase() !== UNISWAP.router.toLowerCase() || tx.input.toLowerCase() !== expected.data.toLowerCase()) {
    return { ok: false, code: 'tx_mismatch', message: 'That transaction isn’t the conversion you confirmed, so I won’t count it.' };
  }
  try {
    await db.update(schema.swaps).set({ swapTx: txHash }).where(and(eq(schema.swaps.id, row.id), sql`(${schema.swaps.swapTx} is null or ${schema.swaps.swapTx} = ${txHash})`));
  } catch {
    return { ok: false, code: 'tx_mismatch', message: 'That transaction was already used for another conversion.' };
  }
  if (receipt.status !== 'success') {
    await db.update(schema.swaps).set({ status: 'FAILED', error: 'reverted' }).where(eq(schema.swaps.id, row.id));
    return { ok: false, code: 'tx_failed', message: 'The conversion didn’t go through on-chain, so nothing was converted. Your money is unchanged.' };
  }

  // What arrived: the transfer of the target coin to the wallet inside this very transaction.
  const toAddr = tokenAddress(to).toLowerCase();
  let received = 0n;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== toAddr) continue;
    try {
      const ev = decodeEventLog({ abi: TRANSFER_EVENT, data: log.data, topics: log.topics });
      const args = ev.args as { to: Address; value: bigint };
      if (args.to.toLowerCase() === wallet.toLowerCase()) received += args.value;
    } catch {
      /* not a Transfer */
    }
  }
  if (received < BigInt(row.minOut)) {
    await db.update(schema.swaps).set({ status: 'FAILED', error: 'received_less_than_minimum' }).where(eq(schema.swaps.id, row.id));
    return { ok: false, code: 'tx_mismatch', message: 'The result didn’t match what was agreed, so I haven’t counted it. Check Celoscan for the transaction.' };
  }
  await db.update(schema.swaps).set({ status: 'CONFIRMED', amountOut: received.toString(), confirmedAt: new Date() }).where(eq(schema.swaps.id, row.id));
  return { ok: true, status: 'CONFIRMED', swapId: row.id, from, to, amountIn: formatAmount(BigInt(row.amountIn), 6), amountOut: formatAmount(received, 4), txHash, explorerUrl: explorerUrl(txHash) };
}

export async function cancelSwap(userId: string, swapId: string): Promise<void> {
  const row = await loadOwned(userId, swapId);
  if (!row || (row.status !== 'PREVIEW' && row.status !== 'PREPARED')) return;
  await getDb().update(schema.swaps).set({ status: 'CANCELLED' }).where(eq(schema.swaps.id, row.id));
}

/** Finished conversions, newest first (for Activity and reports). */
export async function listSwaps(userId: string, limit = 20) {
  const rows = await getDb()
    .select()
    .from(schema.swaps)
    .where(and(eq(schema.swaps.userId, userId), eq(schema.swaps.status, 'CONFIRMED')))
    .orderBy(desc(schema.swaps.confirmedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    from: r.fromToken as SwapToken,
    to: r.toToken as SwapToken,
    amountIn: formatAmount(BigInt(r.amountIn), 6),
    amountOut: r.amountOut ? formatAmount(BigInt(r.amountOut), 4) : null,
    txHash: r.swapTx,
    explorerUrl: r.swapTx ? txExplorerUrl(r.swapTx) : null,
    at: (r.confirmedAt ?? r.createdAt).toISOString(),
  }));
}
