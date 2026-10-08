import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/security/ratelimit';
import { withUser, errorResponse, jsonError } from '@/lib/http';
import { getOrCreateUser } from '@/lib/users/service';
import { cancelSwap, confirmApproval, finalizeSwap, prepareSwap, swapsAvailable } from '@/lib/swap/service';

/**
 * The steps of one conversion, after the person tapped Confirm in chat:
 *   prepare  → re-check the price, cover gas, return exactly what their wallet should sign
 *   approved → their approval transaction was sent; wait for it and check it
 *   finalize → their swap transaction was sent; prove it's the one we prepared and report what arrived
 *   cancel   → they changed their mind
 * Each step only ever acts on the signed-in user's own conversion.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await withUser(req);
  if ('response' in auth) return auth.response;
  const tooMany = rateLimit('swaps-step', auth.user.userId, { max: 40, windowMs: 60_000 });
  if (tooMany) return tooMany;
  if (!swapsAvailable()) return jsonError(404, 'swaps_disabled');
  const { id } = await ctx.params;

  let body: { action?: unknown; txHash?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, 'invalid_body');
  }
  const action = typeof body.action === 'string' ? body.action : '';
  const txHash = typeof body.txHash === 'string' ? body.txHash : '';

  try {
    const user = await getOrCreateUser(auth.user.userId);
    if (action === 'prepare') {
      const r = await prepareSwap(user.id, id);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: r.code === 'not_found' ? 404 : 409 });
    }
    if (action === 'approved') {
      const r = await confirmApproval(user.id, id, txHash);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    if (action === 'finalize') {
      const r = await finalizeSwap(user.id, id, txHash);
      return r.ok ? NextResponse.json(r) : NextResponse.json(r, { status: 409 });
    }
    if (action === 'cancel') {
      await cancelSwap(user.id, id);
      return NextResponse.json({ ok: true });
    }
    return jsonError(400, 'unknown_action');
  } catch (e) {
    return errorResponse(e);
  }
}
