import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { features } from '@/lib/config';
import { createFiatOrder, listFiatOrders, orderKeyForQuote } from '@/lib/fiat/service';
import { presentOrder } from '@/lib/fiat/present';

/**
 * Fiat orders (§4–5, §11). POST confirms a quote into an order after a full policy pass; the order
 * opens in AWAITING_FUNDING / AWAITING_ASSET and settles later via verified webhooks — never here.
 * GET lists the user's orders. Disabled unless a fiat provider is configured.
 */
export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled', { message: 'Fiat conversion is not enabled yet.' });

  let body: { quoteId?: unknown; payoutAccountId?: unknown; idempotencyKey?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const quoteId = typeof body.quoteId === 'string' ? body.quoteId : '';
  const payoutAccountId = typeof body.payoutAccountId === 'string' ? body.payoutAccountId : undefined;
  const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
  if (!quoteId) return jsonError(400, 'missing_fields', { message: 'quoteId is required.' });

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await createFiatOrder({
      userId: user.id,
      quoteId,
      payoutAccountId,
      idempotencyKey: idempotencyKey ?? orderKeyForQuote(quoteId),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'order_failed', message: res.error, policy: res.policy ?? null }, { status: 422 });
    }
    return NextResponse.json({ order: presentOrder(res.order), funding: res.funding ?? null });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function GET(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled');

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const orders = await listFiatOrders(user.id);
    return NextResponse.json({ orders: orders.map(presentOrder) });
  } catch (e) {
    return errorResponse(e);
  }
}
