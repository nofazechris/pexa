import 'server-only';
import { parseAbiItem, getAddress, type Address } from 'viem';
import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { celoClient } from '@/lib/celo/client';
import { getWalletByUserId } from '@/lib/wallets/service';
import { PAY_TOKENS, PAY_TOKEN_SYMBOLS } from '@/lib/buy/tokens';
import { planScan, toDeposit, type Deposit } from './scan';

/**
 * Deposits: money that reached a user's wallet from outside Pexa. Found by reading the stablecoins' on-chain Transfer
 * events to the wallet (never inferred from balance changes, which can't say how much arrived or when). Payments between
 * Pexa users are already `payments`, so a transfer that is one of those is skipped here — it shows up as "received".
 *
 * Runs on demand (when the app polls for notifications or the deposit card is open), reads only blocks it hasn't read,
 * and is safe to run twice at once: each on-chain transfer can be stored only once.
 */

const TRANSFER = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const TOKEN_ADDRESSES: Record<string, string> = Object.fromEntries(PAY_TOKEN_SYMBOLS.map((s) => [s, PAY_TOKENS[s].address]));

/** A run reads for at most this long, and any single blockchain call is abandoned after SLICE_TIMEOUT_MS. */
const SCAN_BUDGET_MS = 8_000;
const SLICE_TIMEOUT_MS = 6_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// Don't scan the same wallet more than once every few seconds, however often it is polled.
const MIN_GAP_MS = 8_000;
const lastScan = new Map<string, number>();

export interface DepositView {
  id: string;
  token: string;
  /** Human amount, e.g. "2.00". */
  amount: string;
  amountAtomic: string;
  from: string;
  txHash: string;
  at: string;
}

function view(r: schema_WalletDeposit): DepositView {
  return {
    id: r.id,
    token: r.token,
    amount: (Number(r.amountAtomic) / 1e6).toFixed(Number(r.amountAtomic) % 10_000 === 0 ? 2 : 4),
    amountAtomic: r.amountAtomic,
    from: r.fromAddress,
    txHash: r.txHash,
    at: r.occurredAt.toISOString(),
  };
}
type schema_WalletDeposit = typeof schema.walletDeposits.$inferSelect;

/** Read new blocks for the user's wallet and record any deposits. Returns the ones found this run. Never throws. */
export async function scanDeposits(userId: string): Promise<DepositView[]> {
  try {
    const wallet = await getWalletByUserId(userId);
    if (!wallet) return [];
    const key = wallet.address.toLowerCase();
    const now = Date.now();
    if (now - (lastScan.get(key) ?? 0) < MIN_GAP_MS) return [];
    lastScan.set(key, now);

    const db = getDb();
    const client = celoClient();
    const [latestBig, cursorRows] = await Promise.all([
      client.getBlockNumber(),
      db.select().from(schema.depositCursors).where(eq(schema.depositCursors.walletAddress, key)).limit(1),
    ]);
    const plan = planScan(cursorRows[0]?.lastBlock ?? null, Number(latestBig));
    if (plan.slices.length === 0 || plan.endBlock === null) return [];

    const found: Deposit[] = [];
    // The last block we READ SUCCESSFULLY. A slow or failed slice ends this run early; the cursor only moves to here,
    // so the next run resumes from the first unread block and nothing is skipped.
    let doneEnd: number | null = null;
    const started = Date.now();
    for (const [from, to] of plan.slices) {
      if (Date.now() - started > SCAN_BUDGET_MS) break;
      let logs;
      try {
        logs = await withTimeout(
          client.getLogs({
            address: Object.values(TOKEN_ADDRESSES).map((a) => getAddress(a)) as Address[],
            event: TRANSFER,
            args: { to: getAddress(wallet.address) },
            fromBlock: BigInt(from),
            toBlock: BigInt(to),
          }),
          SLICE_TIMEOUT_MS,
        );
      } catch (e) {
        console.error(`[deposits] blocks ${from}-${to} not read (${e instanceof Error ? e.message : e}); resuming next run`);
        break;
      }
      doneEnd = to;
      for (const l of logs) {
        const d = toDeposit(
          { address: l.address, args: { from: l.args.from as string, to: l.args.to as string, value: l.args.value as bigint }, blockNumber: l.blockNumber, logIndex: l.logIndex, transactionHash: l.transactionHash },
          wallet.address,
          TOKEN_ADDRESSES,
        );
        if (d) found.push(d);
      }
    }

    if (doneEnd === null) return []; // the very first slice failed or timed out — nothing read, cursor untouched

    // Transfers that are Pexa payments are already shown as payments; don't double-count them as deposits.
    let fresh = found;
    if (found.length > 0) {
      const known = await db
        .select({ h: sql<string>`lower(${schema.payments.txHash})` })
        .from(schema.payments)
        .where(inArray(sql`lower(${schema.payments.txHash})`, found.map((f) => f.txHash)));
      const skip = new Set(known.map((k) => k.h));
      fresh = found.filter((f) => !skip.has(f.txHash));
    }

    const stored: DepositView[] = [];
    for (const d of fresh) {
      const block = await client.getBlock({ blockNumber: BigInt(d.blockNumber) });
      const [row] = await db
        .insert(schema.walletDeposits)
        .values({
          userId,
          walletAddress: key,
          txHash: d.txHash,
          logIndex: d.logIndex,
          token: d.token,
          amountAtomic: d.amountAtomic,
          fromAddress: d.from,
          blockNumber: d.blockNumber,
          occurredAt: new Date(Number(block.timestamp) * 1000),
        })
        .onConflictDoNothing({ target: [schema.walletDeposits.txHash, schema.walletDeposits.logIndex] })
        .returning();
      if (row) stored.push(view(row));
    }

    // Move the cursor forward only after the slices were read successfully (greatest, so a racing run can't move it back).
    await db
      .insert(schema.depositCursors)
      .values({ walletAddress: key, lastBlock: doneEnd })
      .onConflictDoUpdate({
        target: schema.depositCursors.walletAddress,
        set: { lastBlock: sql`greatest(${schema.depositCursors.lastBlock}, ${doneEnd})`, updatedAt: new Date() },
      });
    return stored;
  } catch (e) {
    console.error('[deposits] scan failed (will retry next time):', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Deposits recorded for the user after `since`, newest first (the deposit card uses this to know when money arrived). */
export async function depositsSince(userId: string, since: Date, limit = 10): Promise<DepositView[]> {
  const rows = await getDb()
    .select()
    .from(schema.walletDeposits)
    .where(and(eq(schema.walletDeposits.userId, userId), gt(schema.walletDeposits.occurredAt, since)))
    .orderBy(desc(schema.walletDeposits.occurredAt))
    .limit(limit);
  return rows.map(view);
}

/** The user's most recent deposits, for the notification feed. */
export async function recentDeposits(userId: string, limit = 20): Promise<DepositView[]> {
  const rows = await getDb().select().from(schema.walletDeposits).where(eq(schema.walletDeposits.userId, userId)).orderBy(desc(schema.walletDeposits.occurredAt)).limit(limit);
  return rows.map(view);
}
