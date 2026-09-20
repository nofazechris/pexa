import { NextResponse } from 'next/server';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { features } from '@/lib/config';
import { getFiatQuote } from '@/lib/fiat/service';
import { presentQuote } from '@/lib/fiat/present';

/**
 * Create an NGN↔USDT conversion quote (§4–5). Runs the AgentPolicyEngine and returns a
 * display-ready, expiring quote. Nothing is charged or moved — the user confirms next via
 * /api/fiat/orders. Disabled unless a fiat provider is configured.
 */
export async function POST(req: Request) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  if (!features.fiat) return jsonError(404, 'fiat_not_enabled', { message: 'Fiat conversion is not enabled yet.' });

  let body: { side?: unknown; amount?: unknown; amountCurrency?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const side = body.side === 'buy' || body.side === 'sell' ? body.side : null;
  const amount = typeof body.amount === 'string' ? body.amount : '';
  const amountCurrency = body.amountCurrency === 'NGN' || body.amountCurrency === 'USDT' ? body.amountCurrency : undefined;
  if (!side || !amount) return jsonError(400, 'missing_fields', { message: 'side (buy|sell) and amount are required.' });

  try {
    const user = await getOrCreateUser(auth.user.userId);
    const res = await getFiatQuote({ userId: user.id, side, amount, amountCurrency });
    if (!res.ok) {
      return NextResponse.json({ error: 'quote_unavailable', message: res.error, policy: res.policy ?? null }, { status: 422 });
    }
    return NextResponse.json({ quote: presentQuote(res.result.quote), sandbox: features.fiatSandbox });
  } catch (e) {
    return errorResponse(e);
  }
}
