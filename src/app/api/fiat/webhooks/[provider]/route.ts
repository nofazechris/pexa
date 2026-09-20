import { NextResponse } from 'next/server';
import { features } from '@/lib/config';
import { errorResponse } from '@/lib/http';
import { applyWebhookEvent } from '@/lib/fiat/settlement';

/**
 * Fiat provider webhook (§21). Providers POST settlement events here. There is NO user session —
 * the request is trusted only after its signature verifies inside the provider adapter. Events are
 * idempotent and drive the order state machine; nothing here is re-priced. Never trust a client's
 * claimed status: only a signature-verified webhook advances an order.
 */
export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  if (!features.fiat) return NextResponse.json({ error: 'fiat_not_enabled' }, { status: 404 });
  const { provider } = await ctx.params;

  // Read the raw body so the signature is verified against the exact bytes sent.
  const rawBody = await req.text();
  const signature =
    req.headers.get('x-webhook-signature') ??
    req.headers.get('x-signature') ??
    req.headers.get('x-pexa-signature');

  try {
    const outcome = await applyWebhookEvent(provider, rawBody, signature);
    return NextResponse.json(outcome.body, { status: outcome.status });
  } catch (e) {
    return errorResponse(e);
  }
}
