import 'server-only';
import { desc, eq, inArray, or } from 'drizzle-orm';
import { formatUnits } from 'viem';
import { getDb, schema } from '@/lib/db';
import { listPayments } from '@/lib/payments/engine';
import { listPurchases } from '@/lib/buy/service';
import { recentDeposits, scanDeposits } from '@/lib/deposits/service';
import { buildFeed, type NotificationItem } from './feed';

/**
 * Gathers a user's real events into the notification feed. Each source is best-effort: if one can't be read (a slow
 * blockchain call, Buy being off on a test network) the rest still show, so a hiccup never blanks the whole bar.
 */

export interface NotificationsView {
  items: NotificationItem[];
  unread: number;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.error('[notifications] a source failed:', e instanceof Error ? e.message : e);
    return fallback;
  }
}

/** The moment the user last looked. The first time we see someone, we start their clock now, so old history isn't "new". */
async function seenAtFor(userId: string): Promise<Date> {
  const db = getDb();
  const [row] = await db.select().from(schema.notificationState).where(eq(schema.notificationState.userId, userId)).limit(1);
  if (row) return row.seenAt;
  const now = new Date();
  await db.insert(schema.notificationState).values({ userId, seenAt: now }).onConflictDoNothing();
  return now;
}

export async function getNotifications(userId: string): Promise<NotificationsView> {
  await scanDeposits(userId); // never throws; finds anything that arrived from outside Pexa

  const db = getDb();
  const [payments, requestRows, purchases, deposits, seenAt] = await Promise.all([
    safe(() => listPayments(userId, 40), []),
    safe(
      () =>
        db
          .select()
          .from(schema.requests)
          .where(or(eq(schema.requests.requesterUserId, userId), eq(schema.requests.payerUserId, userId)))
          .orderBy(desc(schema.requests.createdAt))
          .limit(30),
      [],
    ),
    safe(() => listPurchases(userId, 30), []),
    safe(() => recentDeposits(userId, 20), []),
    seenAtFor(userId),
  ]);

  // Names for the other side of each request.
  const otherIds = [...new Set(requestRows.map((r) => (r.requesterUserId === userId ? r.payerUserId : r.requesterUserId)))];
  const names = new Map<string, string>();
  if (otherIds.length) {
    const profs = await safe(() => db.select({ userId: schema.profiles.userId, username: schema.profiles.username }).from(schema.profiles).where(inArray(schema.profiles.userId, otherIds)), []);
    for (const p of profs) names.set(p.userId, '@' + p.username);
  }

  const items = buildFeed({
    seenAt,
    payments: payments.map((p) => ({
      id: p.id,
      direction: p.direction,
      counterparty: p.counterparty,
      amount: p.amount,
      token: p.token,
      status: p.status,
      memo: p.memo,
      // Money you received counts from when it arrived; everything else from when you made it.
      at: p.direction === 'in' ? (p.confirmedAt ?? p.createdAt) : p.createdAt,
    })),
    requests: requestRows.map((r) => {
      const mine = r.requesterUserId === userId;
      return {
        id: r.id,
        direction: mine ? ('out' as const) : ('in' as const),
        counterparty: names.get(mine ? r.payerUserId : r.requesterUserId) ?? 'Someone',
        amount: formatUnits(BigInt(r.amount), 6),
        status: r.status,
        memo: r.memo,
        at: r.status === 'PAID' ? (r.paidAt ?? r.createdAt) : r.status === 'PENDING' ? r.createdAt : (r.cancelledAt ?? r.createdAt),
      };
    }),
    purchases: purchases.map((b) => ({ id: b.id, service: b.service, price: b.price, token: b.token, status: b.status, at: new Date(b.paidAt ?? b.createdAt) })),
    deposits: deposits.map((d) => ({ id: d.id, amount: d.amount, token: d.token, from: d.from, at: new Date(d.at) })),
  });
  return { items, unread: items.filter((i) => i.unread).length };
}

/** The user has looked: everything so far counts as read. */
export async function markNotificationsSeen(userId: string): Promise<void> {
  const now = new Date();
  await getDb()
    .insert(schema.notificationState)
    .values({ userId, seenAt: now })
    .onConflictDoUpdate({ target: schema.notificationState.userId, set: { seenAt: now } });
}
