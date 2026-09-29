import 'server-only';
import { and, eq, inArray, lt } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db/errors';
import { getFiatProvider } from './index';
import { canReach, isTerminal, isValidStatus, type FiatOrderStatus } from './state';
import type { OrderSide } from './provider';

/**
 * Fiat settlement & reconciliation (§21–22). Verified provider webhooks are the ONLY thing that
 * advances a fiat order past its opening state — never the client and never the AI. Settlement
 * never re-prices: the order's naira/USDT amounts and fee are locked from the quote at creation,
 * and this only moves the status. Every event is signature-verified, idempotent (unique on
 * provider+eventId), and applied through the state machine's reachability guard.
 */

const FAILURE_STATUSES = new Set(['FAILED', 'REFUNDED', 'REVERSED', 'CANCELLED', 'EXPIRED']);

/** Map a provider's status token to our side-appropriate state, or null if unrecognized. */
function mapProviderStatus(side: OrderSide, raw: string): FiatOrderStatus | null {
  const done: FiatOrderStatus = side === 'buy' ? 'SETTLED' : 'PAID';
  const table: Record<string, FiatOrderStatus | null> = {
    completed: done,
    complete: done,
    success: done,
    successful: done,
    settled: done,
    paid: done,
    done: done,
    processing: 'PROCESSING',
    pending: null,
    failed: 'FAILED',
    error: 'FAILED',
    refunded: 'REFUNDED',
    reversed: 'REVERSED',
    expired: 'EXPIRED',
    cancelled: 'CANCELLED',
    canceled: 'CANCELLED',
    funding_received: side === 'buy' ? 'FUNDING_RECEIVED' : null,
    asset_received: side === 'sell' ? 'ASSET_RECEIVED' : null,
    payout_processing: side === 'sell' ? 'PAYOUT_PROCESSING' : null,
  };
  const t = table[raw.toLowerCase()] ?? null;
  return t && isValidStatus(side, t) ? t : null;
}

export interface WebhookOutcome {
  status: number;
  body: Record<string, unknown>;
}

/** Apply one inbound provider webhook. Safe to call repeatedly — a re-delivery is a no-op. */
export async function applyWebhookEvent(providerId: string, rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  const provider = getFiatProvider();
  if (providerId !== provider.id) return { status: 404, body: { error: 'unknown_provider' } };

  const verification = await provider.handleWebhook(rawBody, signature);
  if (!verification.valid || !verification.event) return { status: 401, body: { error: 'invalid_signature' } };
  const ev = verification.event;

  const db = getDb();

  // Idempotency + audit: log the event first; a duplicate delivery is acknowledged as a no-op (§21).
  try {
    await db.insert(schema.providerWebhookEvents).values({
      provider: provider.id,
      eventId: ev.id,
      type: ev.type,
      providerOrderId: ev.providerOrderId ?? null,
      status: ev.status ?? null,
      payload: rawBody.slice(0, 4000),
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { status: 200, body: { ok: true, duplicate: true } };
    }
    throw e;
  }

  if (!ev.providerOrderId) return { status: 200, body: { ok: true, note: 'no_order_ref' } };

  const rows = await db
    .select()
    .from(schema.fiatOrders)
    .where(eq(schema.fiatOrders.providerOrderId, ev.providerOrderId))
    .limit(1);
  const order = rows[0];
  // Unknown order: acknowledge (logged for reconciliation) rather than erroring the provider.
  if (!order) return { status: 200, body: { ok: true, note: 'order_not_found' } };

  const side = order.side as OrderSide;
  // A provider may send our exact state (sandbox) or its own token (Quidax "completed"/"failed"…);
  // map the latter to the side-appropriate state.
  const target = ev.status && isValidStatus(side, ev.status) ? ev.status : mapProviderStatus(side, ev.status ?? '');
  if (!target) return { status: 200, body: { ok: true, note: 'unmapped_status' } };
  if (isTerminal(side, order.status as FiatOrderStatus)) return { status: 200, body: { ok: true, note: 'already_terminal' } };
  if (!canReach(side, order.status as FiatOrderStatus, target)) {
    return { status: 200, body: { ok: true, note: 'illegal_transition_ignored', from: order.status, to: target } };
  }

  const extra: Partial<typeof schema.fiatOrders.$inferInsert> = { status: target, updatedAt: new Date() };
  if (isTerminal(side, target)) extra.completedAt = new Date();
  if (FAILURE_STATUSES.has(target)) extra.failureReason = ev.type;

  await db.update(schema.fiatOrders).set(extra).where(eq(schema.fiatOrders.id, order.id));
  return { status: 200, body: { ok: true, orderId: order.id, from: order.status, to: target } };
}

/**
 * SANDBOX ONLY — simulate the provider settling an order to its terminal happy state (buy→SETTLED,
 * sell→PAID), so the full NGN↔USDT loop completes end-to-end in dev/demo without an external
 * provider. It goes through the SAME state-machine guard and logs a webhook-event row, so it
 * exercises the real settlement path. Never runs against a real provider (guarded on provider.sandbox).
 */
export async function simulateSandboxSettlement(orderId: string): Promise<void> {
  const provider = getFiatProvider();
  if (!provider.sandbox) return;
  const db = getDb();
  const rows = await db.select().from(schema.fiatOrders).where(eq(schema.fiatOrders.id, orderId)).limit(1);
  const order = rows[0];
  if (!order) return;
  const side = order.side as OrderSide;
  const target: FiatOrderStatus = side === 'buy' ? 'SETTLED' : 'PAID';
  if (isTerminal(side, order.status as FiatOrderStatus) || !canReach(side, order.status as FiatOrderStatus, target)) return;

  // Audit/idempotency parity with a real webhook (deterministic id → a re-run is a no-op).
  try {
    await db.insert(schema.providerWebhookEvents).values({
      provider: provider.id,
      eventId: `sbx_auto_${orderId}`,
      type: 'sandbox.autosettle',
      providerOrderId: order.providerOrderId,
      status: target,
      payload: null,
    });
  } catch {
    /* duplicate — already settled */
  }
  await db.update(schema.fiatOrders).set({ status: target, completedAt: new Date(), updatedAt: new Date() }).where(eq(schema.fiatOrders.id, order.id));
}

/**
 * Reconciliation sweep (§22): expire orders that were never funded/asset-received before their
 * quote lapsed, so a stale order can't sit open forever. Bounded per run. Deterministic — the
 * amounts are never touched, only the status.
 */
export async function reconcileFiatOrders(limit = 200): Promise<{ checked: number; expired: number }> {
  const db = getDb();
  const stale = await db
    .select()
    .from(schema.fiatOrders)
    .where(
      and(
        inArray(schema.fiatOrders.status, ['QUOTE_CREATED', 'AWAITING_FUNDING', 'AWAITING_ASSET']),
        lt(schema.fiatOrders.expiresAt, new Date()),
      ),
    )
    .limit(limit);

  let expired = 0;
  for (const order of stale) {
    const side = order.side as OrderSide;
    if (!canReach(side, order.status as FiatOrderStatus, 'EXPIRED')) continue;
    await db
      .update(schema.fiatOrders)
      .set({ status: 'EXPIRED', failureReason: 'quote_expired', completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.fiatOrders.id, order.id));
    expired++;
  }
  return { checked: stale.length, expired };
}
