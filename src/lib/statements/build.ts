import 'server-only';
import { and, eq, gte, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { txExplorerUrl } from '@/lib/config';
import { listPayments } from '@/lib/payments/engine';
import { listPurchases } from '@/lib/buy/service';
import { getProfileByUserId } from '@/lib/users/service';
import { assembleStatement, type StatementData, type StatementRow } from './format';
import type { Period } from './period';

/**
 * Gathers everything that moved money for this user in a period — payments sent and received, deposits from outside Pexa,
 * conversions and Buy purchases — into one statement. Only this user's own records, read from our own database (which only ever
 * records what the chain confirmed).
 */

const paymentStatus = (s: string): string => (s === 'CONFIRMED' ? 'Completed' : s === 'FAILED' ? 'Failed' : 'Pending');

export async function buildStatement(userId: string, period: Period): Promise<StatementData> {
  const db = getDb();
  const inRange = (iso: Date | string) => {
    const t = new Date(iso).getTime();
    return t >= period.start.getTime() && t < period.end.getTime() + 1;
  };

  const [payments, deposits, swapRows, purchases, profile] = await Promise.all([
    listPayments(userId, 500),
    db.select().from(schema.walletDeposits).where(and(eq(schema.walletDeposits.userId, userId), gte(schema.walletDeposits.occurredAt, period.start), lt(schema.walletDeposits.occurredAt, new Date(period.end.getTime() + 1)))),
    db.select().from(schema.swaps).where(and(eq(schema.swaps.userId, userId), eq(schema.swaps.status, 'CONFIRMED'), gte(schema.swaps.confirmedAt, period.start), lt(schema.swaps.confirmedAt, new Date(period.end.getTime() + 1)))),
    listPurchases(userId, 100),
    getProfileByUserId(userId),
  ]);

  const rows: StatementRow[] = [];

  for (const p of payments) {
    if (p.status === 'FAILED' || !inRange(p.confirmedAt ?? p.createdAt)) continue;
    const out = p.direction === 'out';
    rows.push({
      at: new Date(p.confirmedAt ?? p.createdAt).toISOString(),
      kind: out ? 'sent' : 'received',
      description: `${out ? 'To' : 'From'} ${p.counterparty}${p.memo ? ` — ${p.memo}` : ''}`,
      amount: (out ? -1 : 1) * Number(p.amount),
      token: p.token,
      status: paymentStatus(p.status),
      url: p.explorerUrl,
    });
  }

  for (const d of deposits) {
    rows.push({
      at: d.occurredAt.toISOString(),
      kind: 'deposit',
      description: 'Deposit from outside Pexa',
      amount: Number(d.amountAtomic) / 1e6,
      token: d.token,
      status: 'Completed',
      url: txExplorerUrl(d.txHash),
    });
  }

  for (const s of swapRows) {
    const out = s.amountOut ? Number(s.amountOut) / 1e6 : null;
    rows.push({
      at: (s.confirmedAt ?? s.createdAt).toISOString(),
      kind: 'conversion',
      description: `Converted ${(Number(s.amountIn) / 1e6).toFixed(2)} ${s.fromToken} → ${out !== null ? out.toFixed(4) : '?'} ${s.toToken}`,
      amount: 0,
      token: `${s.fromToken}→${s.toToken}`,
      status: 'Completed',
      url: s.swapTx ? txExplorerUrl(s.swapTx) : null,
    });
  }

  for (const b of purchases) {
    if (b.status !== 'PAID' || !b.paidAt || !inRange(b.paidAt)) continue;
    rows.push({
      at: new Date(b.paidAt).toISOString(),
      kind: 'purchase',
      description: `Buy: ${b.service}`,
      amount: -(Number(b.priceAtomic) / 1e6),
      token: b.token,
      status: 'Completed',
      url: b.txHash ? txExplorerUrl(b.txHash) : null,
    });
  }

  return assembleStatement({ label: period.label, start: period.start, end: period.end, username: profile?.username ?? null, rows });
}
