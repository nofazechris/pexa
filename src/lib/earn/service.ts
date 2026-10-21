import 'server-only';
import { and, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { decodeEventLog, erc20Abi, getAddress, type Hex } from 'viem';
import { getDb, schema } from '@/lib/db';
import { activeNetwork, env, features, txExplorerUrl } from '@/lib/config';
import { celoClient } from '@/lib/celo/client';
import { getErc20Balance } from '@/lib/celo/balance';
import { getWalletByUserId } from '@/lib/wallets/service';
import { availableBalanceRaw } from '@/lib/vaults/service';
import { relayerCeloBalance, sendGasTopUp } from '@/lib/relayer/service';
import { appendTag } from '@/lib/relayer/tag';
import { aaveCeloRewards } from '@/lib/yield/service';
import {
  AAVE,
  EARN_LIMITS,
  MAX_UINT256,
  buildApprove,
  buildSupply,
  buildWithdraw,
  dataProviderAbi,
  earnTokenAddress,
  formatAmount,
  parseAmount,
  poolAbi,
  rayToApyPercent,
  type EarnAction,
  type EarnToken,
  type EarnTx,
} from './aave';

/**
 * Depositing into Aave v3 on Celo and withdrawing again. The server reads the market from the chain, remembers exactly what the
 * person agreed to, covers the network fee, checks every step on-chain and reports what the chain says moved. The person's own
 * wallet signs — Pexa never holds or moves their money, and it can only ever credit their own address.
 */

const QUOTE_TTL_MS = 5 * 60 * 1000;
/** Approve (~50k gas) + supply (~300k) with room to spare; a withdrawal needs no approval. */
const GAS_UNITS_DEPOSIT = 600_000n;
const GAS_UNITS_WITHDRAW = 350_000n;
const MAX_TOP_UP_WEI = 300_000_000_000_000_000n; // 0.3 CELO per top-up
const MIN_RELAYER_WEI = 1_000_000_000_000_000_000n; // stop topping up below 1 CELO left
const MAX_TOP_UPS_PER_DAY = 6;
const MAX_PREVIEWS_PER_HOUR = 20;

export interface EarnPreview {
  earnId: string;
  action: EarnAction;
  token: EarnToken;
  /** Human amount; for "withdraw everything" this is the balance right now. */
  amount: string;
  isMax: boolean;
  protocol: string;
  network: string;
  /** What Aave pays on the deposit itself (percent, from the chain). */
  baseApy: string;
  /** Temporary incentive rewards (percent), when the public data shows any. */
  rewardApy: string | null;
  /** What they already have in Aave for this coin, human. */
  position: string;
  expiresAt: string;
}

export type PreviewResult = { ok: true; preview: EarnPreview } | { ok: false; message: string; /** Buttons for the sensible ways forward when what they asked for doesn't fit what they hold. */ suggest?: { label: string; text: string }[] };

export function earnAvailable(): boolean {
  return features.gaslessRelayer && activeNetwork.network === 'mainnet';
}

interface Reserve {
  active: boolean;
  frozen: boolean;
  paused: boolean;
  /** Atomic headroom under the supply cap, or null when there is no cap. */
  headroom: bigint | null;
  aToken: Hex;
  baseApy: number;
}

export async function readReserve(token: EarnToken): Promise<Reserve> {
  const client = celoClient();
  const asset = earnTokenAddress(token);
  const [cfg, caps, paused, total, data] = await Promise.all([
    client.readContract({ address: AAVE.dataProvider, abi: dataProviderAbi, functionName: 'getReserveConfigurationData', args: [asset] }),
    client.readContract({ address: AAVE.dataProvider, abi: dataProviderAbi, functionName: 'getReserveCaps', args: [asset] }),
    client.readContract({ address: AAVE.dataProvider, abi: dataProviderAbi, functionName: 'getPaused', args: [asset] }),
    client.readContract({ address: AAVE.dataProvider, abi: dataProviderAbi, functionName: 'getATokenTotalSupply', args: [asset] }),
    client.readContract({ address: AAVE.pool, abi: poolAbi, functionName: 'getReserveData', args: [asset] }),
  ]);
  const capUnits = caps[1];
  const headroom = capUnits === 0n ? null : (() => { const room = capUnits * 1_000_000n - total; return room > 0n ? room : 0n; })();
  return { active: cfg[8], frozen: cfg[9], paused, headroom, aToken: data.aTokenAddress as Hex, baseApy: rayToApyPercent(data.currentLiquidityRate) };
}

async function positionOf(token: EarnToken, wallet: string, aToken?: Hex): Promise<bigint> {
  const a = aToken ?? (await readReserve(token)).aToken;
  return getErc20Balance(a, wallet);
}

/** What the wallet can spend of this coin (USDC is net of what's set aside in savings vaults). */
async function spendable(userId: string, wallet: string, token: EarnToken): Promise<bigint> {
  const raw = await getErc20Balance(earnTokenAddress(token), wallet);
  return token === 'USDC' ? availableBalanceRaw(userId, raw.toString(), 'USDC') : raw;
}

const pct = (n: number) => (n >= 10 ? n.toFixed(1) : n.toFixed(2));

/** The calldata the person signs: tagged with the attribution tag when one is configured. */
const tagTx = (tx: EarnTx): EarnTx => ({ ...tx, data: appendTag(tx.data, env.CELO_ATTRIBUTION_TAG) });

function buildFor(row: typeof schema.earnActions.$inferSelect, wallet: `0x${string}`): { approve: EarnTx | null; main: EarnTx } {
  const token = row.token as EarnToken;
  const amount = BigInt(row.amount);
  if (row.action === 'deposit') return { approve: buildApprove(token, amount), main: buildSupply(token, amount, wallet) };
  return { approve: null, main: buildWithdraw(token, row.isMax ? MAX_UINT256 : amount, wallet) };
}

function present(row: typeof schema.earnActions.$inferSelect, baseApy: number, rewardApy: number | null, position: bigint): EarnPreview {
  return {
    earnId: row.id,
    action: row.action as EarnAction,
    token: row.token as EarnToken,
    amount: formatAmount(BigInt(row.amount), 6),
    isMax: row.isMax,
    protocol: 'Aave v3',
    network: activeNetwork.name,
    baseApy: pct(baseApy),
    rewardApy: rewardApy !== null && rewardApy > 0 ? pct(rewardApy) : null,
    position: formatAmount(position, 6),
    expiresAt: row.expiresAt.toISOString(),
  };
}

/** Work out what the person asked for and remember it. Nothing moves until they confirm and sign. */
export async function createEarnPreview(userId: string, action: EarnAction, token: EarnToken, amountText: string | 'all'): Promise<PreviewResult> {
  if (!earnAvailable()) return { ok: false, message: 'Earning isn’t switched on yet.' };
  const wallet = await getWalletByUserId(userId);
  if (!wallet) return { ok: false, message: 'I couldn’t find your wallet yet. Open the Wallet tab once, then ask me again.' };

  const db = getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.earnActions)
    .where(and(eq(schema.earnActions.userId, userId), gt(schema.earnActions.createdAt, new Date(Date.now() - 3_600_000))));
  if (n >= MAX_PREVIEWS_PER_HOUR) return { ok: false, message: 'That’s a lot in a short time — give it a few minutes and try again.' };

  let reserve: Reserve;
  try {
    reserve = await readReserve(token);
  } catch (e) {
    console.error('[earn] reserve read failed:', e instanceof Error ? e.message : e);
    return { ok: false, message: 'I couldn’t read Aave just now. Nothing was changed — try again in a moment.' };
  }
  const position = await positionOf(token, wallet.address, reserve.aToken).catch(() => 0n);

  let amount: bigint;
  let isMax = false;
  if (action === 'deposit') {
    if (!reserve.active || reserve.frozen || reserve.paused) return { ok: false, message: `Aave isn’t accepting ${token} deposits right now. Nothing was changed.` };
    const available = await spendable(userId, wallet.address, token);
    if (amountText === 'all') {
      amount = available;
    } else {
      const parsed = parseAmount(amountText);
      if (parsed === null) return { ok: false, message: 'I didn’t catch the amount — give me a number like 5 or 25.50.' };
      amount = parsed;
    }
    if (amount < EARN_LIMITS.minAtomic) return { ok: false, message: 'The smallest deposit is $0.10.' };
    if (amount > EARN_LIMITS.maxAtomic) return { ok: false, message: `In beta the largest single deposit is $${formatAmount(EARN_LIMITS.maxAtomic)}. Try a smaller amount.` };
    if (amount > available) {
      const base = `You have $${formatAmount(available)} ${token} available${token === 'USDC' ? ' (money set aside in vaults isn’t counted)' : ''} — that’s less than $${formatAmount(amount)}.`;
      // They may hold the OTHER coin Aave takes: say so, and offer to deposit that instead or convert it first.
      const other: EarnToken = token === 'USDT' ? 'USDC' : 'USDT';
      const otherAvailable = await spendable(userId, wallet.address, other).catch(() => 0n);
      if (otherAvailable >= amount) {
        const amt = formatAmount(amount, 6).replace(/\.?0+$/, '');
        return { ok: false, message: `${base} You do have $${formatAmount(otherAvailable)} ${other}: I can deposit that instead, or convert it to ${token} first.`, suggest: [{ label: `Deposit ${other} instead`, text: `Deposit ${amt} ${other} into Aave` }, { label: `Convert ${other} to ${token} first`, text: `Convert ${amt} ${other} to ${token}` }] };
      }
      return { ok: false, message: base };
    }
    if (reserve.headroom !== null && amount > reserve.headroom) return { ok: false, message: `Aave’s ${token} market is nearly full, so it can’t take $${formatAmount(amount)} right now.` };
  } else {
    if (position === 0n) return { ok: false, message: `You don’t have any ${token} in Aave through this wallet.` };
    if (amountText === 'all') {
      amount = position;
      isMax = true;
    } else {
      const parsed = parseAmount(amountText);
      if (parsed === null) return { ok: false, message: 'I didn’t catch the amount — give me a number like 5 or 25.50, or say “all”.' };
      amount = parsed;
      if (amount > position) return { ok: false, message: `You have $${formatAmount(position)} ${token} in Aave — that’s less than $${formatAmount(amount)}.` };
      // Within a cent of everything: take it all so no dust is left behind.
      if (position - amount < 10_000n) {
        amount = position;
        isMax = true;
      }
    }
    if (amount < 1n) return { ok: false, message: 'There’s nothing to withdraw.' };
    const liquidity = await getErc20Balance(earnTokenAddress(token), reserve.aToken).catch(() => null);
    if (liquidity !== null && amount > liquidity) return { ok: false, message: `Aave only has $${formatAmount(liquidity)} ${token} available to withdraw right now (it lends the rest out). Try a smaller amount or come back later.` };
  }

  const rewards = await aaveCeloRewards(token).catch(() => null);
  const [row] = await db
    .insert(schema.earnActions)
    .values({ userId, walletAddress: wallet.address, action, token, amount: amount.toString(), isMax, baseApyBps: Math.round(reserve.baseApy * 100), status: 'PREVIEW', expiresAt: new Date(Date.now() + QUOTE_TTL_MS) })
    .returning();
  return { ok: true, preview: present(row, reserve.baseApy, rewards?.apyReward ?? null, position) };
}

async function loadOwned(userId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.earnActions)
    .where(and(eq(schema.earnActions.id, id), eq(schema.earnActions.userId, userId)))
    .limit(1);
  return row ?? null;
}

export type StepError = { ok: false; code: 'not_found' | 'expired' | 'insufficient' | 'unavailable' | 'gas_unavailable' | 'bad_state' | 'tx_mismatch' | 'tx_failed'; message: string };

export interface PreparedEarn {
  ok: true;
  from: string;
  action: EarnAction;
  token: EarnToken;
  needsApproval: boolean;
  txs: EarnTx[];
}

/** The person tapped Confirm: re-check the market and balance, make sure the wallet can pay gas, and hand back exactly what to sign. */
export async function prepareEarn(userId: string, id: string): Promise<PreparedEarn | StepError> {
  const row = await loadOwned(userId, id);
  if (!row) return { ok: false, code: 'not_found', message: 'I can’t find that.' };
  if (row.status !== 'PREVIEW' && row.status !== 'PREPARED') return { ok: false, code: 'bad_state', message: 'That was already handled.' };
  const db = getDb();
  if (row.expiresAt.getTime() < Date.now()) {
    await db.update(schema.earnActions).set({ status: 'EXPIRED' }).where(eq(schema.earnActions.id, row.id));
    return { ok: false, code: 'expired', message: 'That quote expired. Ask me again for a fresh one.' };
  }
  const token = row.token as EarnToken;
  const action = row.action as EarnAction;
  const wallet = getAddress(row.walletAddress);
  const amount = BigInt(row.amount);

  let reserve: Reserve;
  try {
    reserve = await readReserve(token);
  } catch {
    return { ok: false, code: 'unavailable', message: 'I couldn’t read Aave just now. Nothing was changed — try again in a moment.' };
  }
  if (action === 'deposit') {
    if (!reserve.active || reserve.frozen || reserve.paused) return { ok: false, code: 'unavailable', message: `Aave isn’t accepting ${token} deposits right now. Nothing was changed.` };
    if (reserve.headroom !== null && amount > reserve.headroom) return { ok: false, code: 'unavailable', message: `Aave’s ${token} market is full now. Nothing was changed.` };
    const bal = await getErc20Balance(earnTokenAddress(token), wallet);
    if (bal < amount) return { ok: false, code: 'insufficient', message: `Your ${token} balance is now lower than this deposit.` };
  } else {
    const pos = await getErc20Balance(reserve.aToken, wallet);
    if (pos < (row.isMax ? 1n : amount)) return { ok: false, code: 'insufficient', message: 'Your balance in Aave is now lower than this withdrawal.' };
    const liquidity = await getErc20Balance(earnTokenAddress(token), reserve.aToken);
    if (liquidity < (row.isMax ? pos : amount)) return { ok: false, code: 'unavailable', message: 'Aave doesn’t have that much available to withdraw right now. Nothing was changed.' };
  }

  // Gas: the wallet needs a little CELO to send the transactions. Pexa covers it, once per action.
  if (!row.gasDripTx) {
    const client = celoClient();
    const units = action === 'deposit' ? GAS_UNITS_DEPOSIT : GAS_UNITS_WITHDRAW;
    const [have, price, relayerHas] = await Promise.all([client.getBalance({ address: wallet }), client.getGasPrice(), relayerCeloBalance()]);
    const need = (price * units * 3n) / 2n;
    if (have < need) {
      const topUp = need - have > MAX_TOP_UP_WEI ? MAX_TOP_UP_WEI : need - have;
      if (relayerHas === null || relayerHas < MIN_RELAYER_WEI) {
        console.error('[earn] relayer is low on CELO — cannot top up gas', relayerHas?.toString());
        return { ok: false, code: 'gas_unavailable', message: 'Earning is paused for a moment on our side. Nothing was changed — please try again later.' };
      }
      const [{ n }] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.earnActions)
        .where(and(eq(schema.earnActions.userId, userId), isNotNull(schema.earnActions.gasDripTx), gt(schema.earnActions.createdAt, new Date(Date.now() - 86_400_000))));
      if (n >= MAX_TOP_UPS_PER_DAY) return { ok: false, code: 'gas_unavailable', message: 'You’ve hit today’s limit in beta. Try again tomorrow.' };
      try {
        const { hash } = await sendGasTopUp({ to: wallet, valueWei: topUp });
        await client.waitForTransactionReceipt({ hash: hash as Hex, timeout: 30_000 });
        await db.update(schema.earnActions).set({ gasDripTx: hash }).where(eq(schema.earnActions.id, row.id));
      } catch (e) {
        console.error('[earn] gas top-up failed:', e instanceof Error ? e.message : e);
        return { ok: false, code: 'gas_unavailable', message: 'I couldn’t prepare the network fee just now. Nothing was changed — try again in a moment.' };
      }
    } else {
      await db.update(schema.earnActions).set({ gasDripTx: 'not_needed' }).where(eq(schema.earnActions.id, row.id));
    }
  }

  const built = buildFor(row, wallet);
  let needsApproval = false;
  const txs: EarnTx[] = [];
  if (built.approve) {
    const allowance = (await celoClient().readContract({ address: earnTokenAddress(token), abi: erc20Abi, functionName: 'allowance', args: [wallet, AAVE.pool] })) as bigint;
    needsApproval = allowance < amount;
    if (needsApproval) txs.push(tagTx(built.approve));
  }
  txs.push(tagTx(built.main));
  await db.update(schema.earnActions).set({ status: 'PREPARED' }).where(eq(schema.earnActions.id, row.id));
  return { ok: true, from: wallet, action, token, needsApproval, txs };
}

/** The approval was sent: wait for it and check it covers the deposit, before the deposit itself is signed. */
export async function confirmApproval(userId: string, id: string, txHash: string): Promise<{ ok: true } | StepError> {
  const row = await loadOwned(userId, id);
  if (!row) return { ok: false, code: 'not_found', message: 'I can’t find that.' };
  if (row.status !== 'PREPARED') return { ok: false, code: 'bad_state', message: 'That isn’t waiting for an approval.' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, code: 'tx_mismatch', message: 'That doesn’t look like a transaction.' };
  const client = celoClient();
  const wallet = getAddress(row.walletAddress);
  try {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 30_000 });
    if (receipt.status !== 'success') return { ok: false, code: 'tx_failed', message: 'The approval didn’t go through. Nothing was deposited.' };
  } catch {
    return { ok: false, code: 'tx_failed', message: 'The approval is taking too long. Nothing was deposited — try again.' };
  }
  const allowance = (await client.readContract({ address: earnTokenAddress(row.token as EarnToken), abi: erc20Abi, functionName: 'allowance', args: [wallet, AAVE.pool] })) as bigint;
  if (allowance < BigInt(row.amount)) return { ok: false, code: 'tx_mismatch', message: 'The approval doesn’t cover this deposit. Nothing was deposited.' };
  await getDb().update(schema.earnActions).set({ approveTx: txHash }).where(eq(schema.earnActions.id, row.id));
  return { ok: true };
}

export interface EarnResult {
  ok: true;
  status: 'CONFIRMED' | 'PENDING';
  earnId: string;
  action: EarnAction;
  token: EarnToken;
  /** What the chain says moved, human; null while pending. */
  amount: string | null;
  /** What they now have in Aave for this coin, human; null if it couldn't be read. */
  position: string | null;
  txHash: string;
  explorerUrl: string;
}

const TRANSFER_EVENT = erc20Abi.filter((x) => x.type === 'event' && x.name === 'Transfer');

/** The action was sent: prove it is OURS, wait for it, and read what really moved from the chain. Safe to call again. */
export async function finalizeEarn(userId: string, id: string, txHash: string): Promise<EarnResult | StepError> {
  const row = await loadOwned(userId, id);
  if (!row) return { ok: false, code: 'not_found', message: 'I can’t find that.' };
  const token = row.token as EarnToken;
  const action = row.action as EarnAction;
  const base = { earnId: row.id, action, token };
  const wallet = getAddress(row.walletAddress);
  const client = celoClient();

  const positionNow = async () => {
    try {
      return formatAmount(await positionOf(token, wallet), 6);
    } catch {
      return null;
    }
  };

  if (row.status === 'CONFIRMED' && row.actionTx) {
    return { ok: true, status: 'CONFIRMED', ...base, amount: row.amountOut ? formatAmount(BigInt(row.amountOut), 6) : null, position: await positionNow(), txHash: row.actionTx, explorerUrl: txExplorerUrl(row.actionTx) };
  }
  if (row.status !== 'PREPARED') return { ok: false, code: 'bad_state', message: 'That isn’t waiting to be finished.' };
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, code: 'tx_mismatch', message: 'That doesn’t look like a transaction.' };

  const pending = (): EarnResult => ({ ok: true, status: 'PENDING', ...base, amount: null, position: null, txHash, explorerUrl: txExplorerUrl(txHash) });

  let receipt;
  try {
    receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 25_000 });
  } catch {
    return pending();
  }
  let tx;
  try {
    tx = await client.getTransaction({ hash: txHash as Hex });
  } catch {
    return pending();
  }

  // It must be exactly what we prepared: from this wallet, to the Aave pool, with our calldata (tagged, or plain for one prepared before tagging).
  const expected = buildFor(row, wallet).main;
  const sent = tx.input.toLowerCase();
  if (tx.from.toLowerCase() !== wallet.toLowerCase() || (tx.to ?? '').toLowerCase() !== AAVE.pool.toLowerCase() || (sent !== expected.data.toLowerCase() && sent !== tagTx(expected).data.toLowerCase())) {
    return { ok: false, code: 'tx_mismatch', message: 'That transaction isn’t the one you confirmed, so I won’t count it.' };
  }
  const db = getDb();
  try {
    await db.update(schema.earnActions).set({ actionTx: txHash }).where(and(eq(schema.earnActions.id, row.id), sql`(${schema.earnActions.actionTx} is null or ${schema.earnActions.actionTx} = ${txHash})`));
  } catch {
    return { ok: false, code: 'tx_mismatch', message: 'That transaction was already used for something else.' };
  }
  if (receipt.status !== 'success') {
    await db.update(schema.earnActions).set({ status: 'FAILED', error: 'reverted' }).where(eq(schema.earnActions.id, row.id));
    return { ok: false, code: 'tx_failed', message: 'It didn’t go through on-chain, so nothing moved. Your money is unchanged.' };
  }

  // What really moved: the coin's own Transfer log (wallet → Aave on a deposit, Aave → wallet on a withdrawal).
  const asset = earnTokenAddress(token).toLowerCase();
  let moved: bigint | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== asset) continue;
    try {
      const ev = decodeEventLog({ abi: TRANSFER_EVENT, data: log.data, topics: log.topics });
      const a = ev.args as { from: string; to: string; value: bigint };
      const towardWallet = a.to.toLowerCase() === wallet.toLowerCase();
      const fromWallet = a.from.toLowerCase() === wallet.toLowerCase();
      if ((action === 'deposit' && fromWallet) || (action === 'withdraw' && towardWallet)) moved = (moved ?? 0n) + a.value;
    } catch {
      /* not a Transfer */
    }
  }
  await db.update(schema.earnActions).set({ status: 'CONFIRMED', amountOut: moved === null ? null : moved.toString(), confirmedAt: new Date() }).where(eq(schema.earnActions.id, row.id));
  return { ok: true, status: 'CONFIRMED', ...base, amount: moved === null ? null : formatAmount(moved, 6), position: await positionNow(), txHash, explorerUrl: txExplorerUrl(txHash) };
}

export async function cancelEarn(userId: string, id: string): Promise<void> {
  const row = await loadOwned(userId, id);
  if (!row || (row.status !== 'PREVIEW' && row.status !== 'PREPARED')) return;
  await getDb().update(schema.earnActions).set({ status: 'CANCELLED' }).where(eq(schema.earnActions.id, row.id));
}

export interface EarnPosition {
  token: EarnToken;
  /** What they have in Aave now, human (includes what it has earned). */
  balance: string;
  /** What this wallet put in through Pexa minus what it took out, human. */
  netDeposited: string;
  /** Balance minus net deposited, when positive: interest earned, human. Not shown if they also deposited outside Pexa. */
  earned: string | null;
  baseApy: string;
}

/** What the person has in Aave right now, read from the chain. Free and read-only. */
export async function getEarnPositions(userId: string): Promise<EarnPosition[] | null> {
  if (!earnAvailable()) return null;
  const wallet = await getWalletByUserId(userId);
  if (!wallet) return null;
  const rows = await getDb()
    .select()
    .from(schema.earnActions)
    .where(and(eq(schema.earnActions.userId, userId), eq(schema.earnActions.status, 'CONFIRMED')));
  const out: EarnPosition[] = [];
  for (const token of ['USDT', 'USDC'] as const) {
    try {
      const reserve = await readReserve(token);
      const balance = await getErc20Balance(reserve.aToken, wallet.address);
      if (balance === 0n) continue;
      let net = 0n;
      for (const r of rows.filter((x) => x.token === token)) {
        const moved = r.amountOut ? BigInt(r.amountOut) : BigInt(r.amount);
        net += r.action === 'deposit' ? moved : -moved;
      }
      const earned = net > 0n && balance > net ? balance - net : null;
      out.push({ token, balance: formatAmount(balance, 6), netDeposited: formatAmount(net > 0n ? net : 0n, 6), earned: earned === null ? null : formatAmount(earned, 6), baseApy: pct(reserve.baseApy) });
    } catch {
      /* skip a coin we couldn't read */
    }
  }
  return out;
}
