/**
 * The notification feed: one list of the things a person would want to be told about — money in, money out,
 * subscription payments, deposits, requests, Buy purchases — built from what really happened (never invented) and
 * worded plainly. Pure and tested; the service only gathers the inputs.
 */

export type NotificationKind = 'received' | 'sent' | 'subscription' | 'failed' | 'request' | 'request_paid' | 'request_declined' | 'deposit' | 'purchase';

export interface NotificationItem {
  /** Stable, so the app can tell new from already-seen. */
  id: string;
  kind: NotificationKind;
  title: string;
  detail: string;
  /** ISO time the thing happened. */
  at: string;
  unread: boolean;
  /** Where "see more" goes. */
  tab: 'activity' | 'payments' | 'buy';
  /** Worth a pop-up when it arrives while the app is open (money coming in). */
  highlight: boolean;
}

export interface FeedInputs {
  payments: Array<{ id: string; direction: 'out' | 'in'; counterparty: string; amount: string; token: string; status: string; memo: string | null; at: Date }>;
  requests: Array<{ id: string; direction: 'in' | 'out'; counterparty: string; amount: string; status: string; memo: string | null; at: Date }>;
  purchases: Array<{ id: string; service: string; price: string; token: string; status: string; at: Date }>;
  deposits: Array<{ id: string; amount: string; token: string; from: string; at: Date }>;
  seenAt: Date | null;
}

export const RECURRING_MEMO = 'Recurring payment';
const MAX_ITEMS = 40;

/** "2" → "$2.00", "0.006" → "$0.006", "1234.5" → "$1,234.50". */
export function usd(amount: string | number): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '$0.00';
  if (n > 0 && n < 0.01) return '$' + n.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

export function buildFeed(input: FeedInputs): NotificationItem[] {
  const items: Omit<NotificationItem, 'unread'>[] = [];

  for (const p of input.payments) {
    const amount = usd(p.amount);
    if (p.direction === 'in') {
      if (p.status === 'CONFIRMED') {
        items.push({ id: `pay:${p.id}`, kind: 'received', title: `${p.counterparty} sent you ${amount}`, detail: `${p.token} · received`, at: p.at.toISOString(), tab: 'activity', highlight: true });
      }
      continue;
    }
    const subscription = p.memo === RECURRING_MEMO;
    if (p.status === 'CONFIRMED' || p.status === 'PENDING') {
      items.push({
        id: `pay:${p.id}`,
        kind: subscription ? 'subscription' : 'sent',
        title: subscription ? `Subscription payment: ${amount} to ${p.counterparty}` : `You sent ${amount} to ${p.counterparty}`,
        detail: `${p.token} · ${p.status === 'CONFIRMED' ? 'completed' : 'on its way'}`,
        at: p.at.toISOString(),
        tab: 'activity',
        highlight: false,
      });
    } else if (p.status === 'FAILED') {
      items.push({ id: `pay:${p.id}`, kind: 'failed', title: `${subscription ? 'Subscription payment' : 'Payment'} to ${p.counterparty} failed`, detail: 'Nothing was taken. You can try again.', at: p.at.toISOString(), tab: 'activity', highlight: false });
    }
  }

  for (const r of input.requests) {
    const amount = usd(r.amount);
    if (r.direction === 'in' && r.status === 'PENDING') {
      items.push({ id: `req:${r.id}`, kind: 'request', title: `${r.counterparty} requested ${amount} from you`, detail: r.memo ? `“${r.memo}”` : 'Open Payments to pay or decline', at: r.at.toISOString(), tab: 'payments', highlight: true });
    } else if (r.direction === 'out' && r.status === 'PAID') {
      items.push({ id: `req:${r.id}`, kind: 'request_paid', title: `${r.counterparty} paid your ${amount} request`, detail: r.memo ? `“${r.memo}”` : 'Request settled', at: r.at.toISOString(), tab: 'payments', highlight: true });
    } else if (r.direction === 'out' && r.status === 'DECLINED') {
      items.push({ id: `req:${r.id}`, kind: 'request_declined', title: `${r.counterparty} declined your ${amount} request`, detail: r.memo ? `“${r.memo}”` : '', at: r.at.toISOString(), tab: 'payments', highlight: false });
    }
  }

  for (const b of input.purchases) {
    if (b.status === 'PAID') {
      items.push({ id: `buy:${b.id}`, kind: 'purchase', title: `Bought: ${b.service}`, detail: `${b.price} ${b.token} · result saved`, at: b.at.toISOString(), tab: 'buy', highlight: false });
    } else if (b.status === 'UNCERTAIN') {
      items.push({ id: `buy:${b.id}`, kind: 'purchase', title: `Check this purchase: ${b.service}`, detail: 'We couldn’t confirm it. Please check before retrying.', at: b.at.toISOString(), tab: 'buy', highlight: false });
    }
  }

  for (const d of input.deposits) {
    items.push({ id: `dep:${d.id}`, kind: 'deposit', title: `You deposited ${usd(d.amount)}`, detail: `${d.token} · from ${shortAddress(d.from)}`, at: d.at.toISOString(), tab: 'activity', highlight: true });
  }

  const seen = input.seenAt ? input.seenAt.getTime() : Infinity; // no baseline yet → nothing is "new"
  return items
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, MAX_ITEMS)
    .map((i) => ({ ...i, unread: Date.parse(i.at) > seen }));
}
